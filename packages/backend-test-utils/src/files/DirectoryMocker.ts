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

import { isChildPath, resolveSafeChildPath } from '@backstage/backend-common';
import fs from 'fs-extra';
import textextensions from 'textextensions';
import { tmpdir as getTmpDir } from 'os';
import {
  dirname,
  extname,
  join as joinPath,
  resolve as resolvePath,
  relative as relativePath,
} from 'path';

type MockEntry =
  | {
      type: 'file';
      path: string;
      content: Buffer;
    }
  | {
      type: 'dir';
      path: string;
    };

export type MockDirectory = {
  [name in string]: MockDirectory | string | Buffer;
};

interface DirectoryMockerOptions {
  /**
   * The root path to create the directory in. Defaults to a temporary directory.
   *
   * If an existing directory is provided, it will not be cleaned up after the test.
   */
  root?: string;
}

interface DirectoryMockerGetContentOptions {
  path?: string;

  /**
   * Whether or not to return files as text rather than buffers.
   *
   * Defaults to checking the file extension against a list of known text extensions.
   */
  shouldReadAsText?: boolean | ((path: string, buffer: Buffer) => boolean);
}

export class DirectoryMocker {
  static create(options?: DirectoryMockerOptions) {
    const root =
      options?.root ??
      fs.mkdtempSync(joinPath(getTmpDir(), 'backstage-tmp-test-dir-'));

    const mocker = new DirectoryMocker(root);

    const shouldCleanup = !options?.root || !fs.pathExistsSync(options.root);
    if (shouldCleanup) {
      process.on('beforeExit', mocker.#cleanupSync);

      try {
        afterAll(mocker.removeContent);
      } catch {
        /* ignore */
      }
    }

    return mocker;
  }

  readonly #root: string;

  private constructor(root: string) {
    this.#root = root;
  }

  get dir() {
    return this.#root;
  }

  async setContent(root: MockDirectory) {
    await this.removeContent();

    return this.addContent(root);
  }

  async addContent(root: MockDirectory) {
    const entries = this.#transformInput(root);

    for (const entry of entries) {
      const fullPath = resolveSafeChildPath(this.#root, entry.path);
      if (!isChildPath(this.#root, fullPath)) {
        throw new Error(
          `Provided path must resolve to a child path of the mock directory, got ${entry.path}`,
        );
      }

      if (entry.type === 'dir') {
        await fs.ensureDir(fullPath);
      } else if (entry.type === 'file') {
        await fs.ensureDir(dirname(fullPath));
        await fs.writeFile(fullPath, entry.content);
      }
    }
  }

  async getContent(
    options?: DirectoryMockerGetContentOptions,
  ): Promise<MockDirectory | undefined> {
    const shouldReadAsText =
      (typeof options?.shouldReadAsText === 'boolean'
        ? () => options?.shouldReadAsText
        : options?.shouldReadAsText) ??
      ((path: string) => textextensions.includes(extname(path).slice(1)));

    const root = resolvePath(this.#root, options?.path ?? '');
    if (!isChildPath(this.#root, root)) {
      throw new Error(
        `Provided path must resolve to a child path of the mock directory, got ${relativePath(
          this.#root,
          root,
        )}`,
      );
    }

    async function read(path: string): Promise<MockDirectory | undefined> {
      if (!(await fs.pathExists(path))) {
        return undefined;
      }

      const entries = await fs.readdir(path, { withFileTypes: true });
      return Object.fromEntries(
        await Promise.all(
          entries.map(async entry => {
            const fullPath = resolvePath(path, entry.name);

            if (entry.isDirectory()) {
              return [entry.name, await read(fullPath)];
            }
            const content = await fs.readFile(fullPath);

            if (shouldReadAsText(fullPath, content)) {
              return [entry.name, content.toString('utf8')];
            }
            return [entry.name, content];
          }),
        ),
      );
    }

    return read(root);
  }

  removeContent = async () => {
    await fs.rm(this.#root, { recursive: true, force: true });
  };

  #transformInput(input: MockDirectory[string]): MockEntry[] {
    const entries: MockEntry[] = [];

    function traverse(node: MockDirectory[string], path: string) {
      const trimmedPath = path.startsWith('/') ? path.slice(1) : path; // trim leading slash
      if (typeof node === 'string') {
        entries.push({
          type: 'file',
          path: trimmedPath,
          content: Buffer.from(node, 'utf8'),
        });
      } else if (node instanceof Buffer) {
        entries.push({ type: 'file', path: trimmedPath, content: node });
      } else {
        entries.push({ type: 'dir', path: trimmedPath });
        for (const [name, child] of Object.entries(node)) {
          traverse(child, `${trimmedPath}/${name}`);
        }
      }
    }

    traverse(input, '');

    return entries;
  }

  #cleanupSync = () => {
    fs.rmSync(this.#root, { recursive: true, force: true });
  };
}
