/// <reference path="./build-stamp.d.ts" />

export function mainBuildStamp(): { mainBuildSha: string; mainBuiltAt: string } {
  const mainBuildSha =
    typeof __MC_MAIN_BUILD_SHA__ !== 'undefined'
      ? __MC_MAIN_BUILD_SHA__
      : process.env.MC_MAIN_BUILD_SHA ?? 'unknown';
  const mainBuiltAt =
    typeof __MC_MAIN_BUILT_AT__ !== 'undefined'
      ? __MC_MAIN_BUILT_AT__
      : process.env.MC_MAIN_BUILT_AT ?? 'unknown';
  return { mainBuildSha, mainBuiltAt };
}
