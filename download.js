const fetch = require("node-fetch");
const JSZip = require("jszip");
const crypto = require("crypto");
const {promises: fs, constants, createWriteStream} = require("fs");
const path = require("path");
const findCacheDir = require("find-cache-dir");
const rimraf = require("rimraf");
const util = require("util");
const config = require("./config.json");

const thunk = findCacheDir({name: "aws-svg-icons", thunk: true});

const sha = (x) => crypto.createHash("sha256").update(x).digest("hex");

const fileExists = async (file) => {
	try {
		await fs.access(file, constants.F_OK);
		return true;
	}catch(e) {
		return false;
	}
};

const processZip = async (baseDir, file) => {
	const zip = await JSZip.loadAsync(file);

	const nestedResults = await Promise.all(zip.file(/^.*\.zip$/).filter(({name}) => name.indexOf("__MACOSX") === -1).map(async (nestedZip) => {
		return processZip(path.join(baseDir, path.dirname(nestedZip.name)), await nestedZip.async("nodebuffer"));
	}));

	const directResults = await Promise.all(zip.file(/^.*\.svg/).filter(({name}) => name.indexOf("__MACOSX") === -1).map(async (svg) => {
		return {
			path: path.join(baseDir, svg.name),
			contents: await svg.async("nodebuffer"),
		};
	}));

	return [
		...directResults,
		...nestedResults.reduce((memo, a) => memo.concat(a), []),
	];
};

(async () => {
	const file = await (async () => {
		const cacheFile = thunk(sha(config.url));

		if (await fileExists(cacheFile)) {
			return fs.readFile(cacheFile);
		}else {
			const contents = await fetch(config.url)
				.then((res => res.buffer()));

			await fs.mkdir(path.dirname(cacheFile), {recursive: true});
			await fs.writeFile(cacheFile, contents);

			return contents;
		}
	})();

	const r = await processZip(".", file);
	const withFirstPathRemoved = r.map(({path: filePath, ...rest}) => {
		const parts = filePath.split(path.sep);
		const [, ...butFirst] = parts;
		return {path: butFirst.join(path.sep), ...rest};
	});
	await util.promisify(rimraf)("lib");
	await Promise.all(withFirstPathRemoved.map(async ({path: filePath, contents}) => {
		const inLibPath = path.join("lib", filePath);
		await fs.mkdir(path.dirname(inLibPath), {recursive: true});
		await fs.writeFile(inLibPath, contents);
	}));
})();
