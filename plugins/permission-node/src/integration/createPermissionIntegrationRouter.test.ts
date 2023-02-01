/*
 * Copyright 2021 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  AuthorizeResult,
  createPermission,
  Permission,
} from '@backstage/plugin-permission-common';
import express from 'express';
import request, { Response } from 'supertest';
import { z } from 'zod';
import {
  createPermissionIntegrationRouter,
  CreatePermissionIntegrationRouterResourceOptions,
  createIsAuthorized,
} from './createPermissionIntegrationRouter';
import { createPermissionRule } from './createPermissionRule';

const testPermission: Permission = createPermission({
  name: 'test.permission',
  attributes: {},
});

const mockTestRule1Apply = jest
  .fn()
  .mockImplementation((_resource: any, _params) => true);
const testRule1 = createPermissionRule({
  name: 'test-rule-1',
  description: 'Test rule 1',
  resourceType: 'test-resource',
  paramsSchema: z.object({
    foo: z.string(),
    bar: z.number().describe('bar'),
  }),
  apply: mockTestRule1Apply,
  toQuery: _params => ({}),
});

const mockTestRule2Apply = jest
  .fn()
  .mockImplementation((_resource: any) => false);
const testRule2 = createPermissionRule({
  name: 'test-rule-2',
  description: 'Test rule 2',
  resourceType: 'test-resource',
  apply: mockTestRule2Apply,
  toQuery: () => ({}),
});

const defaultMockedGetResources: CreatePermissionIntegrationRouterResourceOptions<
  string,
  { id: string }
>['getResources'] = jest.fn(async resourceRefs =>
  resourceRefs.map(resourceRef => ({ id: resourceRef })),
);

const createApp = (
  mockedGetResources:
    | typeof defaultMockedGetResources
    | null = defaultMockedGetResources,
) => {
  const router = mockedGetResources
    ? createPermissionIntegrationRouter({
        resourceType: 'test-resource',
        permissions: [testPermission],
        getResources: mockedGetResources,
        rules: [testRule1, testRule2],
      })
    : createPermissionIntegrationRouter({ permissions: [testPermission] });

  return express().use(router);
};

describe('createPermissionIntegrationRouter', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /.well-known/backstage/permissions/apply-conditions', () => {
    it.each([
      {
        rule: 'test-rule-1',
        resourceType: 'test-resource',
        params: {
          foo: 'abc',
          bar: 123,
        },
      },
      {
        anyOf: [
          {
            rule: 'test-rule-1',
            resourceType: 'test-resource',
            params: {
              foo: 'a',
              bar: 1,
            },
          },
          {
            rule: 'test-rule-2',
            resourceType: 'test-resource',
          },
        ],
      },
      {
        not: {
          rule: 'test-rule-2',
          resourceType: 'test-resource',
        },
      },
      {
        allOf: [
          {
            anyOf: [
              {
                rule: 'test-rule-1',
                resourceType: 'test-resource',
                params: {
                  foo: 'a',
                  bar: 1,
                },
              },
              {
                rule: 'test-rule-2',
                resourceType: 'test-resource',
              },
            ],
          },
          {
            not: {
              allOf: [
                {
                  rule: 'test-rule-1',
                  resourceType: 'test-resource',
                  params: {
                    foo: 'b',
                    bar: 2,
                  },
                },
                {
                  rule: 'test-rule-2',
                  resourceType: 'test-resource',
                },
              ],
            },
          },
        ],
      },
    ])('returns 200/ALLOW when criteria match (case %#)', async conditions => {
      const response = await request(createApp())
        .post('/.well-known/backstage/permissions/apply-conditions')
        .send({
          items: [
            {
              id: '123',
              resourceRef: 'default:test/resource',
              resourceType: 'test-resource',
              conditions,
            },
          ],
        });

      expect(response.status).toEqual(200);
      expect(response.body).toEqual({
        items: [
          {
            id: '123',
            result: AuthorizeResult.ALLOW,
          },
        ],
      });
    });

    it.each([
      {
        rule: 'test-rule-2',
        resourceType: 'test-resource',
      },
      {
        allOf: [
          {
            rule: 'test-rule-1',
            resourceType: 'test-resource',
            params: {
              foo: 'a',
              bar: 1,
            },
          },
          {
            rule: 'test-rule-2',
            resourceType: 'test-resource',
          },
        ],
      },
      {
        allOf: [
          {
            anyOf: [
              {
                rule: 'test-rule-1',
                resourceType: 'test-resource',
                params: {
                  foo: 'a',
                  bar: 1,
                },
              },
              {
                rule: 'test-rule-2',
                resourceType: 'test-resource',
              },
            ],
          },
          {
            not: {
              allOf: [
                {
                  rule: 'test-rule-1',
                  resourceType: 'test-resource',
                  params: {
                    foo: 'c',
                    bar: 3,
                  },
                },
                {
                  not: {
                    rule: 'test-rule-2',
                    resourceType: 'test-resource',
                  },
                },
              ],
            },
          },
        ],
      },
    ])(
      'returns 200/DENY when criteria do not match (case %#)',
      async conditions => {
        const response = await request(createApp())
          .post('/.well-known/backstage/permissions/apply-conditions')
          .send({
            items: [
              {
                id: '123',
                resourceRef: 'default:test/resource',
                resourceType: 'test-resource',
                conditions,
              },
            ],
          });

        expect(response.status).toEqual(200);
        expect(response.body).toEqual({
          items: [{ id: '123', result: AuthorizeResult.DENY }],
        });
      },
    );

    describe('batched requests', () => {
      let response: Response;

      beforeEach(async () => {
        response = await request(createApp())
          .post('/.well-known/backstage/permissions/apply-conditions')
          .send({
            items: [
              {
                id: '123',
                resourceRef: 'default:test/resource-1',
                resourceType: 'test-resource',
                conditions: {
                  rule: 'test-rule-1',
                  resourceType: 'test-resource',
                  params: {
                    foo: 'a',
                    bar: 1,
                  },
                },
              },
              {
                id: '234',
                resourceRef: 'default:test/resource-1',
                resourceType: 'test-resource',
                conditions: {
                  rule: 'test-rule-2',
                  resourceType: 'test-resource',
                },
              },
              {
                id: '345',
                resourceRef: 'default:test/resource-2',
                resourceType: 'test-resource',
                conditions: {
                  not: {
                    rule: 'test-rule-1',
                    resourceType: 'test-resource',
                    params: {
                      foo: 'a',
                      bar: 1,
                    },
                  },
                },
              },
              {
                id: '456',
                resourceRef: 'default:test/resource-3',
                resourceType: 'test-resource',
                conditions: {
                  not: {
                    rule: 'test-rule-2',
                    resourceType: 'test-resource',
                  },
                },
              },
              {
                id: '567',
                resourceRef: 'default:test/resource-4',
                resourceType: 'test-resource',
                conditions: {
                  anyOf: [
                    {
                      rule: 'test-rule-1',
                      resourceType: 'test-resource',
                      params: {
                        foo: 'a',
                        bar: 1,
                      },
                    },
                    {
                      rule: 'test-rule-2',
                      resourceType: 'test-resource',
                    },
                  ],
                },
              },
            ],
          });
      });

      it('processes batched requests', () => {
        expect(response.status).toEqual(200);
        expect(response.body).toEqual({
          items: [
            { id: '123', result: AuthorizeResult.ALLOW },
            { id: '234', result: AuthorizeResult.DENY },
            { id: '345', result: AuthorizeResult.DENY },
            { id: '456', result: AuthorizeResult.ALLOW },
            { id: '567', result: AuthorizeResult.ALLOW },
          ],
        });
      });

      it('calls getResources for all required resources at once', () => {
        expect(defaultMockedGetResources).toHaveBeenCalledWith([
          'default:test/resource-1',
          'default:test/resource-2',
          'default:test/resource-3',
          'default:test/resource-4',
        ]);
      });
    });

    it('returns 400 when called with incorrect resource type', async () => {
      const response = await request(createApp())
        .post('/.well-known/backstage/permissions/apply-conditions')
        .send({
          items: [
            {
              id: '123',
              resourceRef: 'default:test/resource-1',
              resourceType: 'test-incorrect-resource-1',
              conditions: {
                rule: 'test-rule-1',
                resourceType: 'test-incorrect-resource-1',
                params: {
                  foo: {},
                },
              },
            },
            {
              id: '234',
              resourceRef: 'default:test/resource-2',
              resourceType: 'test-resource',
              conditions: {
                rule: 'test-rule-1',
                resourceType: 'test-resource',
                params: {
                  foo: {},
                },
              },
            },
            {
              id: '345',
              resourceRef: 'default:test/resource-3',
              resourceType: 'test-incorrect-resource-2',
              conditions: {
                rule: 'test-rule-1',
                resourceType: 'test-incorrect-resource-2',
                params: {
                  foo: {},
                },
              },
            },
          ],
        });

      expect(response.status).toEqual(400);
      expect(response.error && response.error.text).toMatch(
        /unexpected resource types: test-incorrect-resource-1, test-incorrect-resource-2/i,
      );
    });

    it('returns 200/DENY when resource is not found', async () => {
      const mockedGetResources: CreatePermissionIntegrationRouterResourceOptions<
        string,
        { id: string }
      >['getResources'] = jest.fn(async resourceRefs =>
        resourceRefs.map(() => undefined),
      );

      const response = await request(createApp(mockedGetResources))
        .post('/.well-known/backstage/permissions/apply-conditions')
        .send({
          items: [
            {
              id: '123',
              resourceRef: 'default:test/resource',
              resourceType: 'test-resource',
              conditions: {
                rule: 'test-rule-1',
                resourceType: 'test-resource',
                params: {},
              },
            },
          ],
        });

      expect(response.status).toEqual(200);
      expect(response.body).toEqual({
        items: [
          {
            id: '123',
            result: AuthorizeResult.DENY,
          },
        ],
      });
    });

    it('interleaves responses for present and missing resources', async () => {
      const mockedGetResources: CreatePermissionIntegrationRouterResourceOptions<
        string,
        { id: string }
      >['getResources'] = jest.fn(async resourceRefs =>
        resourceRefs.map(resourceRef =>
          resourceRef === 'default:test/missing-resource'
            ? undefined
            : { id: resourceRef },
        ),
      );

      const response = await request(createApp(mockedGetResources))
        .post('/.well-known/backstage/permissions/apply-conditions')
        .send({
          items: [
            {
              id: '123',
              resourceRef: 'default:test/resource-1',
              resourceType: 'test-resource',
              conditions: {
                rule: 'test-rule-1',
                resourceType: 'test-resource',
                params: {
                  foo: 'a',
                  bar: 1,
                },
              },
            },
            {
              id: '234',
              resourceRef: 'default:test/missing-resource',
              resourceType: 'test-resource',
              conditions: {
                rule: 'test-rule-1',
                resourceType: 'test-resource',
                params: {
                  foo: 'a',
                  bar: 1,
                },
              },
            },
            {
              id: '345',
              resourceRef: 'default:test/resource-2',
              resourceType: 'test-resource',
              conditions: {
                rule: 'test-rule-1',
                resourceType: 'test-resource',
                params: {
                  foo: 'a',
                  bar: 1,
                },
              },
            },
          ],
        });

      expect(response.status).toEqual(200);
      expect(response.body).toEqual({
        items: [
          {
            id: '123',
            result: AuthorizeResult.ALLOW,
          },
          {
            id: '234',
            result: AuthorizeResult.DENY,
          },
          {
            id: '345',
            result: AuthorizeResult.ALLOW,
          },
        ],
      });
    });

    it.each([
      undefined,
      '',
      {},
      { resourceType: 'test-resource-type' },
      [{ resourceType: 'test-resource-type' }],
      { items: [{ resourceType: 'test-resource-type' }] },
      { items: [{ resourceRef: 'test/resource-ref' }] },
      {
        items: [
          {
            resourceType: 'test-resource-type',
            resourceRef: 'test/resource-ref',
          },
        ],
      },
      { items: [{ conditions: { anyOf: [] } }] },
      {
        items: [
          { conditions: { rule: 'TEST_RULE', resourceType: 'test-resource' } },
        ],
      },
      { items: [{ conditions: { rule: 'TEST_RULE', params: ['foo'] } }] },
      {
        items: [
          { conditions: { resourceType: 'test-resource', params: ['foo'] } },
        ],
      },
    ])(`returns 400 for invalid input %#`, async input => {
      const response = await request(createApp())
        .post('/.well-known/backstage/permissions/apply-conditions')
        .send(input);

      expect(response.status).toEqual(400);
      expect(response.error && response.error.text).toMatch(/invalid/i);
    });

    it('returns 501 with no getResources implementation', async () => {
      const response = await request(createApp(null))
        .post('/.well-known/backstage/permissions/apply-conditions')
        .send({
          items: [],
        });

      expect(response.status).toEqual(501);
      expect(response.body.error.message).toEqual(
        `This plugin does not expose any permission rule or can't evaluate conditional decisions`,
      );
    });
  });

  describe('GET /.well-known/backstage/permissions/metadata', () => {
    it('returns a list of permissions and rules used by a given backend', async () => {
      const response = await request(createApp()).get(
        '/.well-known/backstage/permissions/metadata',
      );

      expect(response.status).toEqual(200);
      expect(response.body).toEqual({
        permissions: [testPermission],
        rules: [
          {
            name: testRule1.name,
            description: testRule1.description,
            resourceType: testRule1.resourceType,
            paramsSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#',
              additionalProperties: false,
              properties: {
                foo: {
                  type: 'string',
                },
                bar: {
                  description: 'bar',
                  type: 'number',
                },
              },
              required: ['foo', 'bar'],
              type: 'object',
            },
          },
          {
            name: testRule2.name,
            description: testRule2.description,
            resourceType: testRule2.resourceType,
            paramsSchema: {
              $schema: 'http://json-schema.org/draft-07/schema#',
              additionalProperties: false,
              properties: {},
              type: 'object',
            },
          },
        ],
      });
    });
  });
});

describe('createIsAuthorized', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return true in case of allowed decision', () => {
    const isAuthorized = createIsAuthorized([testRule1, testRule2]);
    expect(
      isAuthorized(
        {
          result: AuthorizeResult.ALLOW,
        },
        {},
      ),
    ).toBe(true);

    expect(mockTestRule1Apply).not.toHaveBeenCalled();
    expect(mockTestRule2Apply).not.toHaveBeenCalled();
  });
  it('should return false in case of denied decision', () => {
    const isAuthorized = createIsAuthorized([testRule1, testRule2]);
    expect(
      isAuthorized(
        {
          result: AuthorizeResult.DENY,
        },
        {},
      ),
    ).toBe(false);

    expect(mockTestRule1Apply).not.toHaveBeenCalled();
    expect(mockTestRule2Apply).not.toHaveBeenCalled();
  });

  it('should apply conditions to a resource in case of conditional decision', () => {
    const isAuthorized = createIsAuthorized([testRule1, testRule2]);
    expect(
      isAuthorized(
        {
          pluginId: 'plugin',
          resourceType: 'test-resource',
          result: AuthorizeResult.CONDITIONAL,
          conditions: {
            allOf: [
              {
                rule: 'test-rule-1',
                resourceType: 'test-resource',
                params: {
                  foo: 'a',
                  bar: 1,
                },
              },
              {
                rule: 'test-rule-2',
                resourceType: 'test-resource',
                params: {},
              },
            ],
          },
        },
        {},
      ),
    ).toBe(false);

    expect(mockTestRule1Apply).toHaveBeenCalledTimes(1);
    expect(mockTestRule2Apply).toHaveBeenCalledTimes(1);
  });
});
