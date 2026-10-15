import { readFileSync } from 'node:fs';

const cases = JSON.parse(readFileSync(new URL('../tests/fixtures/shortcut-detection-cases.json', import.meta.url), 'utf8'));
const names = new Set(cases.map(test => test.executable.toLowerCase()));
for (const required of ['re9.exe', 'tlou-i.exe', 'mkke.exe', 'pes2013.exe', 'sparkingzero-win64-shipping.exe', 'launcher.exe', 'gtaiv.exe', 're4.exe', 'b1-win64-shipping.exe', 'rdr2.exe', 'gta-sa.exe']) {
	if (!names.has(required)) throw new Error(`Missing shortcut detection fixture: ${required}`);
}
if (!cases.every(test => test.expect && typeof test.expect === 'object')) throw new Error('Every shortcut fixture needs expected safety behavior.');
const arbitraryTitleAlias = cases.find(test => test.executable.toLowerCase() === 'tlou-i.exe' && test.title === 'q');
if (!arbitraryTitleAlias?.expect?.maintainedAliasCanOpenReviewModal || !arbitraryTitleAlias?.expect?.requiresManualConfirmation) {
	throw new Error('Missing regression coverage for a renamed shortcut whose maintained executable alias still needs a review modal.');
}
const tlouExactTitle = cases.find(test => test.executable.toLowerCase() === 'tlou-i.exe' && test.title.includes('The Last of Us'));
if (tlouExactTitle?.expect?.expectedAppId !== '1888930'
		|| !tlouExactTitle?.expect?.invalidUtf8CannotAbortDetection
		|| !tlouExactTitle?.expect?.bulkCanAcceptUniqueExactTitle) {
	throw new Error('Missing TLOUS regression coverage for UTF-8-safe exact-title bulk linking.');
}

const utilSource = readFileSync(new URL('../backend/lib/util.lua', import.meta.url), 'utf8');
const detectorSource = readFileSync(new URL('../backend/lib/shortcut_detection.lua', import.meta.url), 'utf8');
if (!utilSource.includes('function M.sanitize_utf8(value)')
		|| !utilSource.includes('function M.sanitize_utf8_tree(value, seen)')
		|| !detectorSource.includes('cjson.encode(util.sanitize_utf8_tree(value))')) {
	throw new Error('Shortcut detection IPC responses must sanitize malformed upstream UTF-8 before serialization.');
}

const wukong = cases.find(test => test.executable.toLowerCase() === 'b1-win64-shipping.exe');
if (!wukong?.expect?.exactOfficialTitleOverridesAliasCaution || !wukong?.expect?.deepGameFolderIsEvidence) {
	throw new Error('Missing regression coverage for exact-title alias recovery and deep Unreal game-folder evidence.');
}
const rdr2 = cases.find(test => test.executable.toLowerCase() === 'rdr2.exe');
if (!rdr2?.expect?.bulkCanAcceptUniqueExactTitle) {
	throw new Error('Missing regression coverage for unique exact-title bulk linking through a maintained alias.');
}
if (!rdr2?.expect?.selectedExecutableIsPreserved) {
	throw new Error('Missing regression coverage for preserving the selected RDR2 executable.');
}
const rdr2Launcher = cases.find(test => test.executable.toLowerCase() === 'launcher.exe' && test.title === 'Red Dead Redemption 2');
if (!rdr2Launcher?.expect?.selectedExecutableIsPreserved
	|| !rdr2Launcher?.expect?.launcherIsNotSilentlyReplaced) {
	throw new Error('Missing regression coverage for preserving a selected launcher.');
}
const re9 = cases.find(test => test.executable.toLowerCase() === 're9.exe');
const gtaSa = cases.find(test => test.executable.toLowerCase() === 'gta-sa.exe');
const gtaIv = cases.find(test => test.executable.toLowerCase() === 'gtaiv.exe');
if (re9?.expect?.expectedAppId !== '3764200' || !re9?.expect?.verifiedMaintainedAliasFastPath
		|| gtaSa?.expect?.expectedAppId !== '12120' || !gtaSa?.expect?.verifiedMaintainedAliasFastPath
		|| gtaIv?.expect?.expectedAppId !== '12210' || !gtaIv?.expect?.verifiedMaintainedAliasFastPath) {
	throw new Error('Missing regression coverage for officially validated bulk fast paths on maintained executable identities.');
}
const pes2013 = cases.find(test => test.executable.toLowerCase() === 'pes2013.exe');
if (pes2013?.expect?.expectedAppId !== '221430'
		|| !pes2013?.expect?.verifiedMaintainedAliasFastPath
		|| !pes2013?.expect?.appinfoCanValidateWithoutStorePage
		|| !pes2013?.expect?.bulkCanAcceptVerifiedAlias) {
	throw new Error('Missing PES 2013 regression coverage for retired-Store suggestion and appinfo validation.');
}

const aliasSource = readFileSync(new URL('../backend/lib/shortcut_detection_aliases.lua', import.meta.url), 'utf8');
if (!aliasSource.includes('["pes2013"]') || !aliasSource.includes('auto_appid = "221430"')
		|| !aliasSource.includes('auto_appid = "3764200"')
		|| !detectorSource.includes('automatic_alias_appid')
		|| !detectorSource.includes('"maintained_alias"')
		|| !detectorSource.includes('validation_source = "steam_appinfo"')
		|| !detectorSource.includes('local appinfo = detection_fetch_appinfo(appid)')) {
	throw new Error('Legacy AppID suggestions must seed maintained aliases and validate direct evidence through Steam appinfo.');
}

console.log(`Shortcut detection fixture check passed (${cases.length} cases).`);
