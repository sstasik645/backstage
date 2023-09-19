/*
 * Copyright 2023 The Backstage Authors
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
  configApiRef,
  createApiFactory,
  discoveryApiRef,
  fetchApiRef,
  identityApiRef,
} from '@backstage/core-plugin-api';
import {
  createApiExtension,
  createPageExtension,
  createPlugin,
} from '@backstage/frontend-plugin-api';
import {
  techdocsApiRef,
  techdocsStorageApiRef,
} from '@backstage/plugin-techdocs-react';
import React from 'react';
import { TechDocsClient, TechDocsStorageClient } from './client';
import { rootDocsRouteRef, rootRouteRef } from './routes';

/**
 * Responsible for rendering the provided router element
 *
 * @alpha
 */
const TechDocsIndexPage = createPageExtension({
  id: 'plugin.techdocs.indexPage',
  defaultPath: '/docs',
  routeRef: rootRouteRef,
  loader: () =>
    import('./home/components/TechDocsIndexPage').then(m => (
      <m.TechDocsIndexPage />
    )),
});

/**
 * Component responsible for composing a TechDocs reader page experience
 *
 * @alpha
 */
const TechDocsReaderPage = createPageExtension({
  id: 'plugin.techdocs.readerPage',
  loader: () =>
    import('./reader/components/TechDocsReaderPage').then(m => (
      <m.TechDocsReaderPage />
    )),
  routeRef: rootDocsRouteRef,
  defaultPath: '/docs/:namespace/:kind/:name/*',
});

/** @alpha */
const techDocsStorage = createApiExtension({
  api: techdocsStorageApiRef,

  factory() {
    return createApiFactory({
      api: techdocsStorageApiRef,
      deps: {
        configApi: configApiRef,
        discoveryApi: discoveryApiRef,
        identityApi: identityApiRef,
        fetchApi: fetchApiRef,
      },
      factory: ({ configApi, discoveryApi, identityApi, fetchApi }) =>
        new TechDocsStorageClient({
          configApi,
          discoveryApi,
          identityApi,
          fetchApi,
        }),
    });
  },
});

/** @alpha */
const techDocsClient = createApiExtension({
  api: techdocsApiRef,
  factory() {
    return createApiFactory({
      api: techdocsApiRef,
      deps: {
        configApi: configApiRef,
        discoveryApi: discoveryApiRef,
        fetchApi: fetchApiRef,
      },
      factory: ({ configApi, discoveryApi, fetchApi }) =>
        new TechDocsClient({
          configApi,
          discoveryApi,
          fetchApi,
        }),
    });
  },
});

/** @alpha */
export default createPlugin({
  id: 'techdocs',
  extensions: [
    TechDocsIndexPage,
    TechDocsReaderPage,
    techDocsClient,
    techDocsStorage,
  ],
});
