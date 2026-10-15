// Hosted CI has no Steam client. Local verification still requires the real client.
if (process.env.NGL_INSTALLED_STEAM_CHECKS === 'unavailable') {
 console.log('SKIP installed-Steam contract: ' + process.argv[1] + ' (runner has no Steam client)');
 process.exit(0);
}
