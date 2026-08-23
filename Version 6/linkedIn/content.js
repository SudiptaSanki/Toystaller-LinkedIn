// extensions/linkedin/content.js
// LinkedIn-specific content script entry point.
// Boots Toystaller with LinkedIn platform config and interceptor scripts.

// Boot immediately — manifest restricts this to linkedin.com only
bootToystaller([
    'platform.js',              // Sets window.ToystallerPlatform in MAIN world
    'core/interceptor_core.js'  // Patches fetch/XHR and React Fiber extraction
]);
