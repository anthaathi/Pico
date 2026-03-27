#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { execSync } from 'node:child_process';

const PACKAGE_DIR = resolve(import.meta.dirname, '..');
const PROJECT_ROOT = resolve(PACKAGE_DIR, '../..');
const SOURCE_FILE = resolve(PACKAGE_DIR, 'assemblyscript/remote-display-decoder.ts');
const OUTPUT_FILE = resolve(PROJECT_ROOT, 'public/wasm/remote-display-decoder.wasm');
const METADATA_FILE = resolve(PROJECT_ROOT, 'public/wasm/remote-display-decoder.meta.json');
const LOG_PREFIX = '[wasm:remote-display-decoder]';

function findAsc(): string {
    const candidates = [
        resolve(PACKAGE_DIR, 'node_modules/.bin/asc'),
        resolve(PROJECT_ROOT, 'node_modules/.bin/asc'),
    ];
    for (const path of candidates) {
        if (existsSync(path)) return path;
    }
    throw new Error(`${LOG_PREFIX} Missing asc compiler. Run: yarn add -D assemblyscript`);
}

function sha256ForFile(path: string): string {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function main(): void {
    const ascBin = findAsc();
    mkdirSync(dirname(OUTPUT_FILE), { recursive: true });

    const args = [
        ascBin,
        SOURCE_FILE,
        '--target', 'release',
        '--runtime', 'incremental',
        '--exportRuntime',
        '--optimizeLevel', '3',
        '--shrinkLevel', '0',
        '--noAssert',
        '--stackSize', '65536',
        '--outFile', OUTPUT_FILE,
    ];

    console.log(`${LOG_PREFIX} compiling ${relative(PROJECT_ROOT, SOURCE_FILE)}...`);
    execSync(args.join(' '), { cwd: PACKAGE_DIR, stdio: 'inherit' });

    const size = readFileSync(OUTPUT_FILE).byteLength;
    const sha256 = sha256ForFile(OUTPUT_FILE);
    const metadata = {
        manifest_id: 'remote-display-decoder',
        source_file: relative(PROJECT_ROOT, SOURCE_FILE),
        output_file: relative(PROJECT_ROOT, OUTPUT_FILE),
        sha256,
        size_bytes: size,
        toolchain: 'assemblyscript',
        built_at: new Date().toISOString(),
    };
    writeFileSync(METADATA_FILE, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
    console.log(
        `${LOG_PREFIX} built ${relative(PROJECT_ROOT, OUTPUT_FILE)} (${(size / 1024).toFixed(1)} KB)\n` +
        `${LOG_PREFIX} sha256 ${sha256}`,
    );
}

try {
    main();
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
}
