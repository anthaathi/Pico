# Changelog

## [1.9.0](https://github.com/anthaathi/Pico/compare/v1.8.0...v1.9.0) (2026-03-30)


### Features

* add [paths] config for node/npm/pi binary resolution ([e7250b6](https://github.com/anthaathi/Pico/commit/e7250b6539550afb4ff5d765db49ad027a201d61))
* release-please bumps Cargo.toml version for pi-server binary ([bae6172](https://github.com/anthaathi/Pico/commit/bae6172de1a3f40caa059dde772a18aa1cac943c))
* rename app to Pico with new otter logo ([7794316](https://github.com/anthaathi/Pico/commit/77943166af0aa3c77a9c591b8b658a97a2ae8e4b))
* set web title to Anthaathi Pico, sync app.json version, bump via release-please ([1623b8d](https://github.com/anthaathi/Pico/commit/1623b8d61c569f0f9734ff75831a174fdc5e8ca5))


### Bug Fixes

* remove pi-ui prefix from release tags ([dc150ba](https://github.com/anthaathi/Pico/commit/dc150bac22b8da900eab9a5ae83ed101bc026a0c))
* use login shell wrapper for systemd/launchd services ([7690212](https://github.com/anthaathi/Pico/commit/76902123fb82b2cdf476e2315bcddbec76d60e45))

## [1.8.0](https://github.com/anthaathi/Pico/compare/pi-ui-v1.7.1...pi-ui-v1.8.0) (2026-03-30)


### Features

* add 'Open in GitHub/GitLab' button in mobile header for git repos ([24ecbc2](https://github.com/anthaathi/Pico/commit/24ecbc2f0604b6d7bac87ac9146b90fe9b45330f))
* add chat mode and improve mobile message rendering ([2a5de06](https://github.com/anthaathi/Pico/commit/2a5de06258d89804ea2fef226da05cf419d53324))
* add Chat/Tools toggle in toolbar for chat mode ([8bb1e16](https://github.com/anthaathi/Pico/commit/8bb1e16e4b2530269fed67bfa2147bf19f311303))
* add CI/CD pipeline with lint, release-please, EAS update, and APK build ([c8d2403](https://github.com/anthaathi/Pico/commit/c8d24036ce901939e137181cddc4f986fa416cf1))
* add clipboard panel for pasting text to remote desktop ([7811f95](https://github.com/anthaathi/Pico/commit/7811f95225598a340ea2fd23b7564a5546768e8c))
* add custom models settings UI, pi agent update section, runtime status ([70eb43a](https://github.com/anthaathi/Pico/commit/70eb43a06dddfb90fd0d87c6d5af360b4e6fefac))
* add desktop mode with VNC viewer ([c7db6ce](https://github.com/anthaathi/Pico/commit/c7db6cefbe2cecf220fbb9840e04bb6e1986951e))
* add Drag Viewport toggle to VNC menu ([3a59191](https://github.com/anthaathi/Pico/commit/3a591919859c777410fe4e5096cbe8cefdd1c185))
* add one-line curl install script for pi-server ([c547da4](https://github.com/anthaathi/Pico/commit/c547da4c5826b93a03786d908f1aae8131d432fd))
* add Open in GitHub/GitLab button to desktop header bar ([345bb91](https://github.com/anthaathi/Pico/commit/345bb91018680d7d41ef34b4707610050cbad633))
* add session previews and per-session streaming ([9eb9470](https://github.com/anthaathi/Pico/commit/9eb9470b31e92727690cf417d8f24800a5fb9f84))
* add shared UI components (Select, Portal, BottomSheet) and diff panel ([8469b9c](https://github.com/anthaathi/Pico/commit/8469b9c2d262c68902a04c96be1781b4795cb71b))
* add VS Code-style tasks system with auto-detection ([2f79e36](https://github.com/anthaathi/Pico/commit/2f79e36c60baa8cc33fa726e7e809bd1b7e96666))
* added agent modes, download button ([#21](https://github.com/anthaathi/Pico/issues/21)) ([129c6a7](https://github.com/anthaathi/Pico/commit/129c6a782ae163678968bb7de8436e9d3ea055ca))
* auto-resizing prompt input with expand/collapse button ([83b7ede](https://github.com/anthaathi/Pico/commit/83b7ede14b19b66aa388c77d2d7613eb185e81ca))
* bundle web into rust binary, add init command, CI, UI fixes ([8729df3](https://github.com/anthaathi/Pico/commit/8729df36a0bd9078e5644ad0d46e6eef249a3e0f))
* context usage ring next to send button ([ae61473](https://github.com/anthaathi/Pico/commit/ae614737bcffac1c4215d9a00e699b7f3057f3c2))
* default init username to OS username instead of admin ([60e3b63](https://github.com/anthaathi/Pico/commit/60e3b639318202cdbd6fcbd2b554211ad4e64ba1))
* **desktop:** add remote desktop mode with noVNC ([9f3811b](https://github.com/anthaathi/Pico/commit/9f3811b8139ebc07f4dda28eb3c085d039f2042a))
* **desktop:** move to new native vnc render pipeline ([#18](https://github.com/anthaathi/Pico/issues/18)) ([5f4cc68](https://github.com/anthaathi/Pico/commit/5f4cc689313d173e1b6d1653443845f7e640a5e5))
* edit/write diffs open in bottom sheet on mobile ([7706d04](https://github.com/anthaathi/Pico/commit/7706d047a4c273c23d520b2becc11c1fed952e09))
* expand agent session and workspace flows ([68768df](https://github.com/anthaathi/Pico/commit/68768df6712cffd0d2c2bd25a478bcdfe75cf938))
* full inline subagent viewer with markdown, model info, and contentIndex fix ([a22a2da](https://github.com/anthaathi/Pico/commit/a22a2dac44760289b6e18a4a0302606a910ea111))
* group consecutive read tool calls as 'Read N files' in message list ([1e83dba](https://github.com/anthaathi/Pico/commit/1e83dba3b6c1189f73dc191ba85ab5fb8a0da658))
* improve remote session handling ([db44aef](https://github.com/anthaathi/Pico/commit/db44aefa7b570f9a7c5cefc45aedf1a557ff4cbe))
* install to ~/.pi/ui and offer background service setup ([1e24e2a](https://github.com/anthaathi/Pico/commit/1e24e2a21d4893737209c3ce06e767d5ebdaa3f9))
* message list UX improvements ([03aa773](https://github.com/anthaathi/Pico/commit/03aa773eabfdf2dea8c36b064b7f4616f2b33f3f))
* multiple git remotes + nested repo discovery (3 levels deep) ([a83d6d7](https://github.com/anthaathi/Pico/commit/a83d6d7caad5f7a5918a1bed9b76175eee898ed9))
* optimize stream events, add server restart handling, improve UX ([f5140b0](https://github.com/anthaathi/Pico/commit/f5140b0988b14e5f4ec53c41ebe0cf54bfd52ccb))
* organize the server ([abea01c](https://github.com/anthaathi/Pico/commit/abea01c9795369809df767aa94875b0c1345757f))
* release-please bumps Cargo.toml version for pi-server binary ([bae6172](https://github.com/anthaathi/Pico/commit/bae6172de1a3f40caa059dde772a18aa1cac943c))
* removed random file ([a2fe4c8](https://github.com/anthaathi/Pico/commit/a2fe4c8ae0f80a9bd0a48ed6990c316c2a9b30b0))
* rename app to Pico with new otter logo ([7794316](https://github.com/anthaathi/Pico/commit/77943166af0aa3c77a9c591b8b658a97a2ae8e4b))
* rewrite install script as production-quality installer ([19fb44a](https://github.com/anthaathi/Pico/commit/19fb44ae7d55c217d82e9cf82693ec21fb12b202))
* session_state streaming events, hideActions on non-last assistant messages, subagent progress types, remove placeholder UI ([ddac1b6](https://github.com/anthaathi/Pico/commit/ddac1b66a932bc890ab6ce0caec09c246791fdcd))
* set web title to Anthaathi Pico, sync app.json version, bump via release-please ([1623b8d](https://github.com/anthaathi/Pico/commit/1623b8d61c569f0f9734ff75831a174fdc5e8ca5))
* show 'Explored N files' for grouped reads, non-expandable ([e73c218](https://github.com/anthaathi/Pico/commit/e73c218767f25eda5c9583aa29efaab0eaf2cf9c))
* show GitHub/GitLab logos in repo buttons + strip credentials from remote URLs ([ba732b0](https://github.com/anthaathi/Pico/commit/ba732b08120f7cb7b4fecb8a548123d37346f80e))
* show slash commands on mobile with builtin /chat /plan /compact fallbacks ([587fd3f](https://github.com/anthaathi/Pico/commit/587fd3fd7fbe4685db2cc1ec751205a172813dcd))
* smooth animations for messages and tool call expand/collapse ([f2dce2b](https://github.com/anthaathi/Pico/commit/f2dce2bac8954419b3b733527dbaadcefe6ee4b3))
* tap context ring to show usage tooltip with used/free/total ([8d928fc](https://github.com/anthaathi/Pico/commit/8d928fc79f35ce96a2dbf65374f1e6fc955160ef))
* turn-complete banner with session name, haptic feedback, and useTurnEnd hook ([79781b5](https://github.com/anthaathi/Pico/commit/79781b53880b560883fdaedab2d9ce27bfc4842b))


### Bug Fixes

* 'Open in GitHub' label instead of just 'GitHub' ([6c57a3f](https://github.com/anthaathi/Pico/commit/6c57a3f8d904a0e67048ab656050c8d8af3e7af8))
* add 3-retry logic to agent config loading with error state in toolbar ([01443c9](https://github.com/anthaathi/Pico/commit/01443c9081fbbac74759b19d36133f10940bbf5d))
* add KeyboardAvoidingView to native VNC viewer ([0e3d6d5](https://github.com/anthaathi/Pico/commit/0e3d6d5475af52f5e8d6819a6cac1534a399fbba))
* align context ring with send button, thicker 3px stroke ([c98fe7d](https://github.com/anthaathi/Pico/commit/c98fe7dd98ba47d2832b06a1f9959fccb020db85))
* always compute diff ops eagerly, no expanded/sheetOpen gate ([30be16c](https://github.com/anthaathi/Pico/commit/30be16c1076864aad2d0b2b22fb19df1bd88a524))
* always open bottom sheet on tap, don't gate on hasData ([ae024c5](https://github.com/anthaathi/Pico/commit/ae024c5d6a7e7ee7f521b781a7df8d5c67db79ef))
* auto-reconnect global and session streams ([57d98c5](https://github.com/anthaathi/Pico/commit/57d98c5278b691e19fa4c95348428e87b7f9b25e))
* auto-refresh token on API 401 (prompt/steer/abort/etc) ([54c7393](https://github.com/anthaathi/Pico/commit/54c73930df8868ea099bbc0f4cf53ee46d5e0038))
* auto-refresh token on SSE auth error and reconnect stream ([980a269](https://github.com/anthaathi/Pico/commit/980a2691a58b490becd079b306939173c54750df))
* compute diff ops when bottom sheet opens, not just on inline expand ([8b5b8e0](https://github.com/anthaathi/Pico/commit/8b5b8e0daa5a4250c8b652ff5e40fa8a0062b22a))
* context usage = input + cacheRead + cacheWrite (exclude output tokens) ([d2529cc](https://github.com/anthaathi/Pico/commit/d2529cc0c6317a9d1f4bb2267a3561b3eb3aa515))
* context usage = input + output (cache tokens are subsets of input) ([6cbedde](https://github.com/anthaathi/Pico/commit/6cbedde9790dbc628a517d83467f75078541e314))
* context usage includes input + output + cache tokens ([ec2510e](https://github.com/anthaathi/Pico/commit/ec2510e71e766deef21d695562da20c828d04020))
* correct context usage = input + cacheRead + cacheWrite + output ([cbece95](https://github.com/anthaathi/Pico/commit/cbece956a56b5a86a8170f2a8c713fd9cad6f4cf))
* desktop fullscreen not working in mobile app ([5fd9d4c](https://github.com/anthaathi/Pico/commit/5fd9d4c377fc0230124cd8db9783850252b6db5e))
* desktop layout Stack navigator blocking cross-route replace ([cd4345a](https://github.com/anthaathi/Pico/commit/cd4345a331212b638218ff7f2aaab25deb212c96))
* edit/write collapsed by default on mobile, tap opens bottom sheet ([ec0fc6c](https://github.com/anthaathi/Pico/commit/ec0fc6c18636c8fe126012947b47a53a5b836df7))
* focus prompt input on Cmd/Ctrl+V paste on web ([557216a](https://github.com/anthaathi/Pico/commit/557216a257dc585aa50d48c9ca1fe5da3459a8c3))
* full history reload after sleep/long disconnect ([8bcfff7](https://github.com/anthaathi/Pico/commit/8bcfff79469c1fb678c438af4042d5352cfe9863))
* fullscreen now goes true edge-to-edge ([66628d8](https://github.com/anthaathi/Pico/commit/66628d8a02dca257e602ff554f0638517335c498))
* give mobile diff sheet explicit height to prevent collapsed content ([f1e6f20](https://github.com/anthaathi/Pico/commit/f1e6f2049227936b8690ffdc01fc0709a7664735))
* handle non-interactive TTY in installer ([25ee9c6](https://github.com/anthaathi/Pico/commit/25ee9c6cc8be40118ca79f9c98854db02a85dbab))
* hide mode toggle row when desktop is in fullscreen/immersive mode ([33cdb4e](https://github.com/anthaathi/Pico/commit/33cdb4eb82f05ed9becd7ef36ede1fa0aa1c8839))
* improve preview proxy auth and mobile header ([7a021df](https://github.com/anthaathi/Pico/commit/7a021df7707fff7521de9731708317dc677eab05))
* include cached tokens in context usage calculation ([2087ff0](https://github.com/anthaathi/Pico/commit/2087ff0a22f2c9b69739e847f4f8fe406a77f963))
* infinite re-render loop in PromptInput due to unstable empty array reference ([8cac300](https://github.com/anthaathi/Pico/commit/8cac3009dca009fbccae9a4926bd17d0412f68c9))
* inline diff wraps text, no horizontal scroll needed ([5b83ae0](https://github.com/anthaathi/Pico/commit/5b83ae0a882743409917a707e695260a6ada8947))
* install.sh tracks release version in .version file ([67e8da7](https://github.com/anthaathi/Pico/commit/67e8da760bcf7d13480a955b688233cdcc795568))
* keep desktop mode content within safe area ([2777b1f](https://github.com/anthaathi/Pico/commit/2777b1f64c28cddc9ba2c219ebd6dd8aa54b57bc))
* keep desktop toolbar as layout header, add mode toggle inline ([449d47d](https://github.com/anthaathi/Pico/commit/449d47d56355829d44f010ab9adb23fc66067e35))
* LCS max lines 500 → 100 ([f58b5ab](https://github.com/anthaathi/Pico/commit/f58b5abc231f803adc66b65514fadc14e037b706))
* make context usage ring small and subtle, gray, no label ([b8d200a](https://github.com/anthaathi/Pico/commit/b8d200a3743ab1fda5a86309bf3c5b0ba70e86f9))
* markdown bold uses DMSans-SemiBold instead of synthetic bold ([edcc227](https://github.com/anthaathi/Pico/commit/edcc2272db41e5733e19747ea171c38cb2800588))
* merge release pipeline, remove local packages, drop react-native-sse ([0e0c9e9](https://github.com/anthaathi/Pico/commit/0e0c9e9d3e0160092f0eae87e6490c8bc0d73e99))
* move keyboard to React Native layer, let noVNC handle all touch ([e81a50d](https://github.com/anthaathi/Pico/commit/e81a50db44a72204a03ab3d0cb7225da95eb29eb))
* multiple repos button shows 'Open in' with generic icon ([66770d3](https://github.com/anthaathi/Pico/commit/66770d3afe9d11680ce1d5ad1b5c8fb0259e0fd8))
* native preview patches fetch/XHR with preview headers ([86a6808](https://github.com/anthaathi/Pico/commit/86a68080e3cfae2e756f2b77bf8793381e9501e1))
* native preview uses header-based proxy, apps run at root path ([4ff6214](https://github.com/anthaathi/Pico/commit/4ff621459d5c67a8f3192500453c6ea0dad52dee))
* navigate to /settings when no workspace selected in code mode ([18c5781](https://github.com/anthaathi/Pico/commit/18c5781cea011188cfdc767e6f912a04712508c5))
* opt into Node.js 24 for GitHub Actions ([9cb4fa7](https://github.com/anthaathi/Pico/commit/9cb4fa71f4bc3dd229fade0caf3d69e40d10b069))
* persist prompt input text and attachments across resize and session switches ([7c10eaf](https://github.com/anthaathi/Pico/commit/7c10eafc8e7655f529c3a761e3a151fa544a6c79))
* prevent auto-scroll while typing when not streaming ([ba73a71](https://github.com/anthaathi/Pico/commit/ba73a715af76c05ab7d6119afb34f81baa9d05dd))
* prevent keyboard dismissal on VNC viewer tap (noVNC approach) ([fd823b7](https://github.com/anthaathi/Pico/commit/fd823b7ef2467278a9d5d9f92e9196586fb634ce))
* prevent keyboard flicker by disabling noVNC focus-stealing ([c8715d9](https://github.com/anthaathi/Pico/commit/c8715d929fa53211b5a0734fc10177b448fbd91c))
* prevent keyboard from dismissing when tapping VNC viewer ([de33b4b](https://github.com/anthaathi/Pico/commit/de33b4bf010227e5e2a361dc34be4a4e6da35b3f))
* prevent layout shift when toolbar shimmer transitions to real toolbar ([70e8dd0](https://github.com/anthaathi/Pico/commit/70e8dd0d2828d0f2e9bf0738af97fb887e8336ad))
* reduce wasted space in desktop mode on mobile and web ([4eeb5e1](https://github.com/anthaathi/Pico/commit/4eeb5e16df34b9734ee0c20f1951abaf8db48db9))
* remove agent_end authoritative message replacement ([#23](https://github.com/anthaathi/Pico/issues/23)) ([31f1b6a](https://github.com/anthaathi/Pico/commit/31f1b6ac3ae5616dc64e472ae2972b579be59e0f))
* rename release artifacts to include platform names ([6eb302c](https://github.com/anthaathi/Pico/commit/6eb302c4ce4aff00a4c4bd0b265eeb84edf7e529))
* restore header layout, add expandable FAB on mobile for desktop mode ([aae3bdd](https://github.com/anthaathi/Pico/commit/aae3bddab698e77af3a95e87fb21c63b858ddebc))
* restore prompt draft on send failure and show error banners ([1224ee6](https://github.com/anthaathi/Pico/commit/1224ee600208fa40e93a1f045a6d6181b8258e23))
* revert to local APK builds, add project README ([71fcab5](https://github.com/anthaathi/Pico/commit/71fcab519b3eed6df5a49914937eecce5027b6c8))
* rewrite diff bottom sheet with clean layout ([aac2ae1](https://github.com/anthaathi/Pico/commit/aac2ae1982d9d5950177e2cdd3403b6d2b7d6d2d))
* session loading, shimmer, chat sheet, and shared components ([29e9def](https://github.com/anthaathi/Pico/commit/29e9def060fd090d278caf3035fd09b657f7f3e4))
* setup Node before Corepack, add corepack prepare for Yarn 4 ([a0977e7](https://github.com/anthaathi/Pico/commit/a0977e7e2fcaa4a3125c5145ad75200fe38e31c3))
* show write preview content in mobile diff sheet for history loads ([ae70da9](https://github.com/anthaathi/Pico/commit/ae70da99d4600a06d4ae492c5608cc40f8574e97))
* simplify native preview — use stored config approach ([655c299](https://github.com/anthaathi/Pico/commit/655c299140515046c03865fee5fc5644d8cc140a))
* skip lintVital tasks in Android APK builds ([6635cef](https://github.com/anthaathi/Pico/commit/6635cef543e10ce84bbd4f669a79f22f48e19788))
* slash commands query - remove silent catch, add retry, reduce stale time ([10aac85](https://github.com/anthaathi/Pico/commit/10aac854fd17b7c7137e72fd52e8e12a3c57071b))
* smooth message streaming and recover expired sessions ([54ccaf7](https://github.com/anthaathi/Pico/commit/54ccaf7022b6fd9edabbe6e40d0172b02836d5b7))
* speech recognition stale closures, session tracking, and VNC type fixes ([0684e66](https://github.com/anthaathi/Pico/commit/0684e66deb59ac7d6ea947134b90d8d0963ca370))
* status bar icons black in dark mode on Android ([3582cd9](https://github.com/anthaathi/Pico/commit/3582cd97574a63d3a0a2e3f2a5771e98535567f6))
* tapping Explored N files now expands to show individual file reads ([7f11c2b](https://github.com/anthaathi/Pico/commit/7f11c2b38558555b296b8d49f8dd700d04f2ab85))
* turn duration calculation and read tool call streaming performance ([a4b52ba](https://github.com/anthaathi/Pico/commit/a4b52baac8f7a2067e2d87fb75402ca3bd4405ef))
* upgrade Node to 22, use npm for eas-cli install, fix Windows build ([ecb295a](https://github.com/anthaathi/Pico/commit/ecb295aeec87f9f67920359a151b6e2cb6f1ec2b))
* use EAS cloud builds instead of local for Android APK ([7ec8a86](https://github.com/anthaathi/Pico/commit/7ec8a86127912154ac7ece31189f7e5ed1fb5d88))
* use pi-client API for slash commands instead of raw generated SDK ([8b5077b](https://github.com/anthaathi/Pico/commit/8b5077b4ada726fd1c8034e5847d0d0939c67d21))
* use SemiBold (600) everywhere instead of synthetic bold ([e07603a](https://github.com/anthaathi/Pico/commit/e07603a554e999dbebf11d822b945d9fedcd038c))
* use Yarn 4 (Corepack) in CI workflows ([4bf353e](https://github.com/anthaathi/Pico/commit/4bf353e7f8fcdd8fcceb5953b3e8f5ad5135426e))
* workspace/session selection is now per-server ([20455b8](https://github.com/anthaathi/Pico/commit/20455b8d5a8b90431b7b2b46511aaec366ffbdd3))
* wrap VNC viewer in KeyboardAvoidingView ([ab5ac77](https://github.com/anthaathi/Pico/commit/ab5ac77e9bb5763c5e0e9bd394d05f74c79b9ae0))


### Performance Improvements

* enable removeClippedSubviews on native for message list ([206ac6c](https://github.com/anthaathi/Pico/commit/206ac6c91a1ff0399e1e695c5e37bbdce8cbef85))
* optimize diff and syntax highlighting ([21b10ca](https://github.com/anthaathi/Pico/commit/21b10caa29b44ea2cbb80cb9db95b99595aea0c9))
* virtualize tool call groups + detach off-screen code previews ([f9b083b](https://github.com/anthaathi/Pico/commit/f9b083bba4a33960432e9e91db5d7906293066ce))

## [1.8.0](https://github.com/anthaathi/Pico/compare/v1.7.1...v1.8.0) (2026-03-30)


### Features

* full inline subagent viewer with markdown, model info, and contentIndex fix ([a22a2da](https://github.com/anthaathi/Pico/commit/a22a2dac44760289b6e18a4a0302606a910ea111))
* message list UX improvements ([03aa773](https://github.com/anthaathi/Pico/commit/03aa773eabfdf2dea8c36b064b7f4616f2b33f3f))


### Bug Fixes

* install.sh tracks release version in .version file ([67e8da7](https://github.com/anthaathi/Pico/commit/67e8da760bcf7d13480a955b688233cdcc795568))

## [1.7.1](https://github.com/anthaathi/Pico/compare/v1.7.0...v1.7.1) (2026-03-29)


### Bug Fixes

* focus prompt input on Cmd/Ctrl+V paste on web ([557216a](https://github.com/anthaathi/Pico/commit/557216a257dc585aa50d48c9ca1fe5da3459a8c3))
* prevent layout shift when toolbar shimmer transitions to real toolbar ([70e8dd0](https://github.com/anthaathi/Pico/commit/70e8dd0d2828d0f2e9bf0738af97fb887e8336ad))
* speech recognition stale closures, session tracking, and VNC type fixes ([0684e66](https://github.com/anthaathi/Pico/commit/0684e66deb59ac7d6ea947134b90d8d0963ca370))

## [1.7.0](https://github.com/anthaathi/Pico/compare/v1.6.0...v1.7.0) (2026-03-28)


### Features

* added agent modes, download button ([#21](https://github.com/anthaathi/Pico/issues/21)) ([129c6a7](https://github.com/anthaathi/Pico/commit/129c6a782ae163678968bb7de8436e9d3ea055ca))


### Bug Fixes

* remove agent_end authoritative message replacement ([#23](https://github.com/anthaathi/Pico/issues/23)) ([31f1b6a](https://github.com/anthaathi/Pico/commit/31f1b6ac3ae5616dc64e472ae2972b579be59e0f))

## [1.6.0](https://github.com/anthaathi/pi-companion/compare/v1.5.0...v1.6.0) (2026-03-27)


### Features

* default init username to OS username instead of admin ([60e3b63](https://github.com/anthaathi/pi-companion/commit/60e3b639318202cdbd6fcbd2b554211ad4e64ba1))
* **desktop:** move to new native vnc render pipeline ([#18](https://github.com/anthaathi/pi-companion/issues/18)) ([5f4cc68](https://github.com/anthaathi/pi-companion/commit/5f4cc689313d173e1b6d1653443845f7e640a5e5))
* removed random file ([a2fe4c8](https://github.com/anthaathi/pi-companion/commit/a2fe4c8ae0f80a9bd0a48ed6990c316c2a9b30b0))

## [1.5.0](https://github.com/anthaathi/pi-companion/compare/v1.4.0...v1.5.0) (2026-03-26)


### Features

* add clipboard panel for pasting text to remote desktop ([7811f95](https://github.com/anthaathi/pi-companion/commit/7811f95225598a340ea2fd23b7564a5546768e8c))
* add desktop mode with VNC viewer ([c7db6ce](https://github.com/anthaathi/pi-companion/commit/c7db6cefbe2cecf220fbb9840e04bb6e1986951e))
* add Drag Viewport toggle to VNC menu ([3a59191](https://github.com/anthaathi/pi-companion/commit/3a591919859c777410fe4e5096cbe8cefdd1c185))
* add Open in GitHub/GitLab button to desktop header bar ([345bb91](https://github.com/anthaathi/pi-companion/commit/345bb91018680d7d41ef34b4707610050cbad633))
* add session previews and per-session streaming ([9eb9470](https://github.com/anthaathi/pi-companion/commit/9eb9470b31e92727690cf417d8f24800a5fb9f84))
* add shared UI components (Select, Portal, BottomSheet) and diff panel ([8469b9c](https://github.com/anthaathi/pi-companion/commit/8469b9c2d262c68902a04c96be1781b4795cb71b))
* add VS Code-style tasks system with auto-detection ([2f79e36](https://github.com/anthaathi/pi-companion/commit/2f79e36c60baa8cc33fa726e7e809bd1b7e96666))
* auto-resizing prompt input with expand/collapse button ([83b7ede](https://github.com/anthaathi/pi-companion/commit/83b7ede14b19b66aa388c77d2d7613eb185e81ca))
* context usage ring next to send button ([ae61473](https://github.com/anthaathi/pi-companion/commit/ae614737bcffac1c4215d9a00e699b7f3057f3c2))
* **desktop:** add remote desktop mode with noVNC ([9f3811b](https://github.com/anthaathi/pi-companion/commit/9f3811b8139ebc07f4dda28eb3c085d039f2042a))
* edit/write diffs open in bottom sheet on mobile ([7706d04](https://github.com/anthaathi/pi-companion/commit/7706d047a4c273c23d520b2becc11c1fed952e09))
* group consecutive read tool calls as 'Read N files' in message list ([1e83dba](https://github.com/anthaathi/pi-companion/commit/1e83dba3b6c1189f73dc191ba85ab5fb8a0da658))
* improve remote session handling ([db44aef](https://github.com/anthaathi/pi-companion/commit/db44aefa7b570f9a7c5cefc45aedf1a557ff4cbe))
* multiple git remotes + nested repo discovery (3 levels deep) ([a83d6d7](https://github.com/anthaathi/pi-companion/commit/a83d6d7caad5f7a5918a1bed9b76175eee898ed9))
* session_state streaming events, hideActions on non-last assistant messages, subagent progress types, remove placeholder UI ([ddac1b6](https://github.com/anthaathi/pi-companion/commit/ddac1b66a932bc890ab6ce0caec09c246791fdcd))
* show 'Explored N files' for grouped reads, non-expandable ([e73c218](https://github.com/anthaathi/pi-companion/commit/e73c218767f25eda5c9583aa29efaab0eaf2cf9c))
* show GitHub/GitLab logos in repo buttons + strip credentials from remote URLs ([ba732b0](https://github.com/anthaathi/pi-companion/commit/ba732b08120f7cb7b4fecb8a548123d37346f80e))
* show slash commands on mobile with builtin /chat /plan /compact fallbacks ([587fd3f](https://github.com/anthaathi/pi-companion/commit/587fd3fd7fbe4685db2cc1ec751205a172813dcd))
* smooth animations for messages and tool call expand/collapse ([f2dce2b](https://github.com/anthaathi/pi-companion/commit/f2dce2bac8954419b3b733527dbaadcefe6ee4b3))
* tap context ring to show usage tooltip with used/free/total ([8d928fc](https://github.com/anthaathi/pi-companion/commit/8d928fc79f35ce96a2dbf65374f1e6fc955160ef))
* turn-complete banner with session name, haptic feedback, and useTurnEnd hook ([79781b5](https://github.com/anthaathi/pi-companion/commit/79781b53880b560883fdaedab2d9ce27bfc4842b))


### Bug Fixes

* 'Open in GitHub' label instead of just 'GitHub' ([6c57a3f](https://github.com/anthaathi/pi-companion/commit/6c57a3f8d904a0e67048ab656050c8d8af3e7af8))
* add KeyboardAvoidingView to native VNC viewer ([0e3d6d5](https://github.com/anthaathi/pi-companion/commit/0e3d6d5475af52f5e8d6819a6cac1534a399fbba))
* align context ring with send button, thicker 3px stroke ([c98fe7d](https://github.com/anthaathi/pi-companion/commit/c98fe7dd98ba47d2832b06a1f9959fccb020db85))
* always compute diff ops eagerly, no expanded/sheetOpen gate ([30be16c](https://github.com/anthaathi/pi-companion/commit/30be16c1076864aad2d0b2b22fb19df1bd88a524))
* always open bottom sheet on tap, don't gate on hasData ([ae024c5](https://github.com/anthaathi/pi-companion/commit/ae024c5d6a7e7ee7f521b781a7df8d5c67db79ef))
* auto-reconnect global and session streams ([57d98c5](https://github.com/anthaathi/pi-companion/commit/57d98c5278b691e19fa4c95348428e87b7f9b25e))
* auto-refresh token on API 401 (prompt/steer/abort/etc) ([54c7393](https://github.com/anthaathi/pi-companion/commit/54c73930df8868ea099bbc0f4cf53ee46d5e0038))
* auto-refresh token on SSE auth error and reconnect stream ([980a269](https://github.com/anthaathi/pi-companion/commit/980a2691a58b490becd079b306939173c54750df))
* compute diff ops when bottom sheet opens, not just on inline expand ([8b5b8e0](https://github.com/anthaathi/pi-companion/commit/8b5b8e0daa5a4250c8b652ff5e40fa8a0062b22a))
* context usage = input + cacheRead + cacheWrite (exclude output tokens) ([d2529cc](https://github.com/anthaathi/pi-companion/commit/d2529cc0c6317a9d1f4bb2267a3561b3eb3aa515))
* context usage = input + output (cache tokens are subsets of input) ([6cbedde](https://github.com/anthaathi/pi-companion/commit/6cbedde9790dbc628a517d83467f75078541e314))
* context usage includes input + output + cache tokens ([ec2510e](https://github.com/anthaathi/pi-companion/commit/ec2510e71e766deef21d695562da20c828d04020))
* correct context usage = input + cacheRead + cacheWrite + output ([cbece95](https://github.com/anthaathi/pi-companion/commit/cbece956a56b5a86a8170f2a8c713fd9cad6f4cf))
* desktop fullscreen not working in mobile app ([5fd9d4c](https://github.com/anthaathi/pi-companion/commit/5fd9d4c377fc0230124cd8db9783850252b6db5e))
* desktop layout Stack navigator blocking cross-route replace ([cd4345a](https://github.com/anthaathi/pi-companion/commit/cd4345a331212b638218ff7f2aaab25deb212c96))
* edit/write collapsed by default on mobile, tap opens bottom sheet ([ec0fc6c](https://github.com/anthaathi/pi-companion/commit/ec0fc6c18636c8fe126012947b47a53a5b836df7))
* full history reload after sleep/long disconnect ([8bcfff7](https://github.com/anthaathi/pi-companion/commit/8bcfff79469c1fb678c438af4042d5352cfe9863))
* fullscreen now goes true edge-to-edge ([66628d8](https://github.com/anthaathi/pi-companion/commit/66628d8a02dca257e602ff554f0638517335c498))
* give mobile diff sheet explicit height to prevent collapsed content ([f1e6f20](https://github.com/anthaathi/pi-companion/commit/f1e6f2049227936b8690ffdc01fc0709a7664735))
* hide mode toggle row when desktop is in fullscreen/immersive mode ([33cdb4e](https://github.com/anthaathi/pi-companion/commit/33cdb4eb82f05ed9becd7ef36ede1fa0aa1c8839))
* improve preview proxy auth and mobile header ([7a021df](https://github.com/anthaathi/pi-companion/commit/7a021df7707fff7521de9731708317dc677eab05))
* include cached tokens in context usage calculation ([2087ff0](https://github.com/anthaathi/pi-companion/commit/2087ff0a22f2c9b69739e847f4f8fe406a77f963))
* infinite re-render loop in PromptInput due to unstable empty array reference ([8cac300](https://github.com/anthaathi/pi-companion/commit/8cac3009dca009fbccae9a4926bd17d0412f68c9))
* inline diff wraps text, no horizontal scroll needed ([5b83ae0](https://github.com/anthaathi/pi-companion/commit/5b83ae0a882743409917a707e695260a6ada8947))
* keep desktop mode content within safe area ([2777b1f](https://github.com/anthaathi/pi-companion/commit/2777b1f64c28cddc9ba2c219ebd6dd8aa54b57bc))
* keep desktop toolbar as layout header, add mode toggle inline ([449d47d](https://github.com/anthaathi/pi-companion/commit/449d47d56355829d44f010ab9adb23fc66067e35))
* LCS max lines 500 → 100 ([f58b5ab](https://github.com/anthaathi/pi-companion/commit/f58b5abc231f803adc66b65514fadc14e037b706))
* make context usage ring small and subtle, gray, no label ([b8d200a](https://github.com/anthaathi/pi-companion/commit/b8d200a3743ab1fda5a86309bf3c5b0ba70e86f9))
* markdown bold uses DMSans-SemiBold instead of synthetic bold ([edcc227](https://github.com/anthaathi/pi-companion/commit/edcc2272db41e5733e19747ea171c38cb2800588))
* move keyboard to React Native layer, let noVNC handle all touch ([e81a50d](https://github.com/anthaathi/pi-companion/commit/e81a50db44a72204a03ab3d0cb7225da95eb29eb))
* multiple repos button shows 'Open in' with generic icon ([66770d3](https://github.com/anthaathi/pi-companion/commit/66770d3afe9d11680ce1d5ad1b5c8fb0259e0fd8))
* native preview patches fetch/XHR with preview headers ([86a6808](https://github.com/anthaathi/pi-companion/commit/86a68080e3cfae2e756f2b77bf8793381e9501e1))
* native preview uses header-based proxy, apps run at root path ([4ff6214](https://github.com/anthaathi/pi-companion/commit/4ff621459d5c67a8f3192500453c6ea0dad52dee))
* navigate to /settings when no workspace selected in code mode ([18c5781](https://github.com/anthaathi/pi-companion/commit/18c5781cea011188cfdc767e6f912a04712508c5))
* persist prompt input text and attachments across resize and session switches ([7c10eaf](https://github.com/anthaathi/pi-companion/commit/7c10eafc8e7655f529c3a761e3a151fa544a6c79))
* prevent auto-scroll while typing when not streaming ([ba73a71](https://github.com/anthaathi/pi-companion/commit/ba73a715af76c05ab7d6119afb34f81baa9d05dd))
* prevent keyboard dismissal on VNC viewer tap (noVNC approach) ([fd823b7](https://github.com/anthaathi/pi-companion/commit/fd823b7ef2467278a9d5d9f92e9196586fb634ce))
* prevent keyboard flicker by disabling noVNC focus-stealing ([c8715d9](https://github.com/anthaathi/pi-companion/commit/c8715d929fa53211b5a0734fc10177b448fbd91c))
* prevent keyboard from dismissing when tapping VNC viewer ([de33b4b](https://github.com/anthaathi/pi-companion/commit/de33b4bf010227e5e2a361dc34be4a4e6da35b3f))
* reduce wasted space in desktop mode on mobile and web ([4eeb5e1](https://github.com/anthaathi/pi-companion/commit/4eeb5e16df34b9734ee0c20f1951abaf8db48db9))
* restore header layout, add expandable FAB on mobile for desktop mode ([aae3bdd](https://github.com/anthaathi/pi-companion/commit/aae3bddab698e77af3a95e87fb21c63b858ddebc))
* restore prompt draft on send failure and show error banners ([1224ee6](https://github.com/anthaathi/pi-companion/commit/1224ee600208fa40e93a1f045a6d6181b8258e23))
* rewrite diff bottom sheet with clean layout ([aac2ae1](https://github.com/anthaathi/pi-companion/commit/aac2ae1982d9d5950177e2cdd3403b6d2b7d6d2d))
* show write preview content in mobile diff sheet for history loads ([ae70da9](https://github.com/anthaathi/pi-companion/commit/ae70da99d4600a06d4ae492c5608cc40f8574e97))
* simplify native preview — use stored config approach ([655c299](https://github.com/anthaathi/pi-companion/commit/655c299140515046c03865fee5fc5644d8cc140a))
* slash commands query - remove silent catch, add retry, reduce stale time ([10aac85](https://github.com/anthaathi/pi-companion/commit/10aac854fd17b7c7137e72fd52e8e12a3c57071b))
* smooth message streaming and recover expired sessions ([54ccaf7](https://github.com/anthaathi/pi-companion/commit/54ccaf7022b6fd9edabbe6e40d0172b02836d5b7))
* status bar icons black in dark mode on Android ([3582cd9](https://github.com/anthaathi/pi-companion/commit/3582cd97574a63d3a0a2e3f2a5771e98535567f6))
* tapping Explored N files now expands to show individual file reads ([7f11c2b](https://github.com/anthaathi/pi-companion/commit/7f11c2b38558555b296b8d49f8dd700d04f2ab85))
* use pi-client API for slash commands instead of raw generated SDK ([8b5077b](https://github.com/anthaathi/pi-companion/commit/8b5077b4ada726fd1c8034e5847d0d0939c67d21))
* use SemiBold (600) everywhere instead of synthetic bold ([e07603a](https://github.com/anthaathi/pi-companion/commit/e07603a554e999dbebf11d822b945d9fedcd038c))
* workspace/session selection is now per-server ([20455b8](https://github.com/anthaathi/pi-companion/commit/20455b8d5a8b90431b7b2b46511aaec366ffbdd3))
* wrap VNC viewer in KeyboardAvoidingView ([ab5ac77](https://github.com/anthaathi/pi-companion/commit/ab5ac77e9bb5763c5e0e9bd394d05f74c79b9ae0))


### Performance Improvements

* enable removeClippedSubviews on native for message list ([206ac6c](https://github.com/anthaathi/pi-companion/commit/206ac6c91a1ff0399e1e695c5e37bbdce8cbef85))
* optimize diff and syntax highlighting ([21b10ca](https://github.com/anthaathi/pi-companion/commit/21b10caa29b44ea2cbb80cb9db95b99595aea0c9))
* virtualize tool call groups + detach off-screen code previews ([f9b083b](https://github.com/anthaathi/pi-companion/commit/f9b083bba4a33960432e9e91db5d7906293066ce))

## [1.4.0](https://github.com/anthaathi/pi-companion/compare/v1.3.1...v1.4.0) (2026-03-21)


### Features

* add 'Open in GitHub/GitLab' button in mobile header for git repos ([24ecbc2](https://github.com/anthaathi/pi-companion/commit/24ecbc2f0604b6d7bac87ac9146b90fe9b45330f))

## [1.3.1](https://github.com/anthaathi/pi-companion/compare/v1.3.0...v1.3.1) (2026-03-21)


### Bug Fixes

* add 3-retry logic to agent config loading with error state in toolbar ([01443c9](https://github.com/anthaathi/pi-companion/commit/01443c9081fbbac74759b19d36133f10940bbf5d))

## [1.3.0](https://github.com/anthaathi/pi-companion/compare/v1.2.0...v1.3.0) (2026-03-21)


### Features

* add Chat/Tools toggle in toolbar for chat mode ([8bb1e16](https://github.com/anthaathi/pi-companion/commit/8bb1e16e4b2530269fed67bfa2147bf19f311303))

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
