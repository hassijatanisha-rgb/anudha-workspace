// Dependency-injection probe: deliberately never launches a browser.
export const chromium={launch:async options=>{
 throw new Error('CONFIGURED_BROWSER_PROBE '+JSON.stringify(options));
}};
