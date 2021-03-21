const fetch = require("node-fetch");
const JSZip = require("jszip");
const crypto = require("crypto");
const {promises: fs, constants, createWriteStream} = require("fs");
const path = require("path");
const findCacheDir = require("find-cache-dir");
const rimraf = require("rimraf");
const util = require("util");
const config = require("./config.json");
const packageJson = require("./package.json");

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

	await util.promisify(rimraf)("docs");
	await fs.mkdir("docs", {recursive: true});

	await Promise.all(withFirstPathRemoved.map(async ({path: filePath, contents}) => {
		const inDocsPath = path.join("docs", filePath);
		await fs.mkdir(path.dirname(inDocsPath), {recursive: true});
		await fs.writeFile(inDocsPath, contents);
	}));

	const allFolders = withFirstPathRemoved.map(({path: filePath}) => path.dirname(filePath)).filter((e, i, l) => l.indexOf(e) === i).sort((a, b) => a.localeCompare(b));

	const html = `
<!DOCTYPE html>
<html>
	<head>
	<style>
	body{
		background: #eee;
		padding: 2em;
	}
	.icon {
		display: inline-block;
	}
	.icon label {
		display:none;
	}
	.icon:hover {
		background-color: black;
		position: relative;
		cursor: pointer;
	}
	.icon:hover label, .icon:focus label {
		display: block;
		position: absolute;
		padding: 0.5em;
		background: #111;
		color: #FFF;
		top: -2em;
		font-size: 11px;
		font-weight: bold;
		white-space: nowrap;
		border-radius: 4px 4px 4px 0;
	}
	</style>
	<script>
		const copyToClipboard = async (text, div) => {
			const notification = await (async () => {
				try {
					await navigator.clipboard.writeText(text);
					return "Path copied to clipboard!";
				}catch(e) {
					console.error(e);
					return "Failed to copy path to clipboard";
				}
			})();
			const label = div.querySelector("label");
			const originalText = label.innerText;
			label.innerText = notification;
			await new Promise((res) => setTimeout(res, 5000));
			label.innerText = originalText;
		}
	</script>
	</head>
	<body>
		<h1>aws-svg-icons</h1>
		<small>Click on an icon to copy its path to the clipboard</small>
		<h2>Folders</h2>
		<ul>
			${allFolders.map((dirname, i) => `<li><a href="#dir_${i}">${dirname}</a></li>`).join("")}
		</ul>
		${allFolders.map((dirname, i) => `
			<section>
				<h2 id="dir_${i}">${dirname}</h2>
				${withFirstPathRemoved.filter(({path: filePath}) => path.dirname(filePath) === dirname).map(({path: filePath}) => `
					<div class="icon" onclick="copyToClipboard('aws-svg-icons/lib/${filePath}', this)">
						<label>${path.basename(filePath).replace(/\.svg$/, "")}</label>
						<img src="${filePath}"/>
					</div>
				`).join("")}
			</section>
		`).join("")}
		
		<section>
			<br/>
			<b>${withFirstPathRemoved.length}</b> icons from <a href="https://aws.amazon.com/architecture/icons/">https://aws.amazon.com/architecture/icons/</a><br/><br/>
			Asset file: <a href="${config.url}">${config.url}</a><br/><br/>
			<a href="https://github.com/sashee/aws-svg-icons">https://github.com/sashee/aws-svg-icons</a><br/>
			Version: ${packageJson.version}
		</section>
	</body>
</html>
`;
	await fs.writeFile("docs/index.html", html);

})();
