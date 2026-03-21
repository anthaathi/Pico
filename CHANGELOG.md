# Changelog

## [1.2.0](https://github.com/anthaathi/pi-companion/compare/v1.1.0...v1.2.0) (2026-03-21)


### Features

* add one-line curl install script for pi-server ([c547da4](https://github.com/anthaathi/pi-companion/commit/c547da4c5826b93a03786d908f1aae8131d432fd))
* install to ~/.pi/ui and offer background service setup ([1e24e2a](https://github.com/anthaathi/pi-companion/commit/1e24e2a21d4893737209c3ce06e767d5ebdaa3f9))
* rewrite install script as production-quality installer ([19fb44a](https://github.com/anthaathi/pi-companion/commit/19fb44ae7d55c217d82e9cf82693ec21fb12b202))


### Bug Fixes

* handle non-interactive TTY in installer ([25ee9c6](https://github.com/anthaathi/pi-companion/commit/25ee9c6cc8be40118ca79f9c98854db02a85dbab))
* turn duration calculation and read tool call streaming performance ([a4b52ba](https://github.com/anthaathi/pi-companion/commit/a4b52baac8f7a2067e2d87fb75402ca3bd4405ef))

## [1.1.0](https://github.com/anthaathi/pi-companion/compare/v1.0.6...v1.1.0) (2026-03-20)


### Features

* optimize stream events, add server restart handling, improve UX ([f5140b0](https://github.com/anthaathi/pi-companion/commit/f5140b0988b14e5f4ec53c41ebe0cf54bfd52ccb))
* organize the server ([abea01c](https://github.com/anthaathi/pi-companion/commit/abea01c9795369809df767aa94875b0c1345757f))


### Bug Fixes

* session loading, shimmer, chat sheet, and shared components ([29e9def](https://github.com/anthaathi/pi-companion/commit/29e9def060fd090d278caf3035fd09b657f7f3e4))

## [1.0.6](https://github.com/anthaathi/pi-companion/compare/v1.0.5...v1.0.6) (2026-03-20)


### Bug Fixes

* rename release artifacts to include platform names ([6eb302c](https://github.com/anthaathi/pi-companion/commit/6eb302c4ce4aff00a4c4bd0b265eeb84edf7e529))

## [1.0.5](https://github.com/anthaathi/pi-companion/compare/v1.0.4...v1.0.5) (2026-03-19)


### Bug Fixes

* skip lintVital tasks in Android APK builds ([6635cef](https://github.com/anthaathi/pi-companion/commit/6635cef543e10ce84bbd4f669a79f22f48e19788))

## [1.0.4](https://github.com/anthaathi/pi-companion/compare/v1.0.3...v1.0.4) (2026-03-19)


### Bug Fixes

* revert to local APK builds, add project README ([71fcab5](https://github.com/anthaathi/pi-companion/commit/71fcab519b3eed6df5a49914937eecce5027b6c8))

## [1.0.3](https://github.com/anthaathi/pi-companion/compare/v1.0.2...v1.0.3) (2026-03-19)


### Bug Fixes

* use EAS cloud builds instead of local for Android APK ([7ec8a86](https://github.com/anthaathi/pi-companion/commit/7ec8a86127912154ac7ece31189f7e5ed1fb5d88))

## [1.0.2](https://github.com/anthaathi/pi-companion/compare/v1.0.1...v1.0.2) (2026-03-19)


### Bug Fixes

* upgrade Node to 22, use npm for eas-cli install, fix Windows build ([ecb295a](https://github.com/anthaathi/pi-companion/commit/ecb295aeec87f9f67920359a151b6e2cb6f1ec2b))

## [1.0.1](https://github.com/anthaathi/pi-companion/compare/v1.0.0...v1.0.1) (2026-03-19)


### Bug Fixes

* setup Node before Corepack, add corepack prepare for Yarn 4 ([a0977e7](https://github.com/anthaathi/pi-companion/commit/a0977e7e2fcaa4a3125c5145ad75200fe38e31c3))

## 1.0.0 (2026-03-19)


### Features

* add chat mode and improve mobile message rendering ([2a5de06](https://github.com/anthaathi/pi-companion/commit/2a5de06258d89804ea2fef226da05cf419d53324))
* add CI/CD pipeline with lint, release-please, EAS update, and APK build ([c8d2403](https://github.com/anthaathi/pi-companion/commit/c8d24036ce901939e137181cddc4f986fa416cf1))
* add custom models settings UI, pi agent update section, runtime status ([70eb43a](https://github.com/anthaathi/pi-companion/commit/70eb43a06dddfb90fd0d87c6d5af360b4e6fefac))
* bundle web into rust binary, add init command, CI, UI fixes ([8729df3](https://github.com/anthaathi/pi-companion/commit/8729df36a0bd9078e5644ad0d46e6eef249a3e0f))
* expand agent session and workspace flows ([68768df](https://github.com/anthaathi/pi-companion/commit/68768df6712cffd0d2c2bd25a478bcdfe75cf938))


### Bug Fixes

* merge release pipeline, remove local packages, drop react-native-sse ([0e0c9e9](https://github.com/anthaathi/pi-companion/commit/0e0c9e9d3e0160092f0eae87e6490c8bc0d73e99))
* opt into Node.js 24 for GitHub Actions ([9cb4fa7](https://github.com/anthaathi/pi-companion/commit/9cb4fa71f4bc3dd229fade0caf3d69e40d10b069))
* use Yarn 4 (Corepack) in CI workflows ([4bf353e](https://github.com/anthaathi/pi-companion/commit/4bf353e7f8fcdd8fcceb5953b3e8f5ad5135426e))
