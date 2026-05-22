'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const extensionSrc = path.join(repoRoot, 'vscode-extension');
const pkg = JSON.parse(fs.readFileSync(path.join(extensionSrc, 'package.json'), 'utf8'));
const dist = path.join(repoRoot, 'dist');
const stage = path.join(dist, 'win7-agent-vscode-' + pkg.version);
const extensionStage = path.join(stage, 'extension');
const vsixPath = path.join(dist, 'win7-agent-vscode-' + pkg.version + '.vsix');

remove(stage);
remove(vsixPath);
mkdir(extensionStage);

copyDir(extensionSrc, extensionStage, (sourcePath) => {
  const rel = path.relative(extensionSrc, sourcePath).replace(/\\/g, '/');
  return !(
    rel === 'test' ||
    rel.indexOf('test/') === 0 ||
    rel === 'scripts' ||
    rel.indexOf('scripts/') === 0 ||
    /\.vsix$/i.test(rel)
  );
});

copyIfExists(path.join(repoRoot, 'skills'), path.join(extensionStage, 'skills'));
copyIfExists(path.join(repoRoot, 'config'), path.join(extensionStage, 'config'));
copyIfExists(path.join(repoRoot, 'docs'), path.join(extensionStage, 'docs', 'cli'));
copyIfExists(path.join(repoRoot, 'dist', 'agent-win7-x64', 'agent.exe'), path.join(extensionStage, 'agent.exe'));

fs.writeFileSync(path.join(stage, '[Content_Types].xml'), contentTypesXml(), 'utf8');
fs.writeFileSync(path.join(stage, 'extension.vsixmanifest'), manifestXml(pkg), 'utf8');

childProcess.execFileSync('zip', ['-r', '-X', vsixPath, '.'], { cwd: stage, stdio: 'inherit' });
console.log('created ' + vsixPath);

function copyIfExists(src, dst) {
  if (!fs.existsSync(src)) {
    console.warn('warning: missing ' + src);
    return;
  }
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    copyDir(src, dst, () => true);
  } else {
    mkdir(path.dirname(dst));
    fs.copyFileSync(src, dst);
  }
}

function copyDir(src, dst, include) {
  mkdir(dst);
  fs.readdirSync(src).forEach((entry) => {
    const sourcePath = path.join(src, entry);
    if (!include(sourcePath)) {
      return;
    }
    const targetPath = path.join(dst, entry);
    const stat = fs.statSync(sourcePath);
    if (stat.isDirectory()) {
      copyDir(sourcePath, targetPath, include);
    } else {
      mkdir(path.dirname(targetPath));
      fs.copyFileSync(sourcePath, targetPath);
    }
  });
}

function mkdir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function remove(target) {
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

function manifestXml(packageJson) {
  return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="${xml(packageJson.name)}" Version="${xml(packageJson.version)}" Publisher="${xml(packageJson.publisher)}" />
    <DisplayName>${xml(packageJson.displayName)}</DisplayName>
    <Description xml:space="preserve">${xml(packageJson.description)}</Description>
    <Tags>win7,agent,openai,intranet,offline</Tags>
    <Categories>Other</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${xml(packageJson.engines.vscode)}" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Code.Readme" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Code.Changelog" Path="extension/CHANGELOG.md" Addressable="true" />
  </Assets>
</PackageManifest>
`;
}

function contentTypesXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="md" ContentType="text/markdown" />
  <Default Extension="txt" ContentType="text/plain" />
  <Default Extension="xml" ContentType="application/xml" />
  <Default Extension="exe" ContentType="application/octet-stream" />
  <Default Extension="cmd" ContentType="text/plain" />
</Types>
`;
}

function xml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
