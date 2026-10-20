/** Hosted Linux runners install Playwright Chromium; local Windows checks use
 * Edge. Explicit browser settings take precedence on either platform. */
export function browserLaunchOptions(env = process.env, platform = process.platform) {
  if (env.CLOUD_BROWSER_EXECUTABLE) return { executablePath: env.CLOUD_BROWSER_EXECUTABLE };
  if (env.PLAYWRIGHT_CHANNEL) return { channel: env.PLAYWRIGHT_CHANNEL };
  return platform === 'win32' ? { channel: 'msedge' } : {};
}
