/**
 * corsj-app — electron-builder 配置（nsis-web 差分升级 + 便携目录构建）。
 * 见 package.json scripts：dist:win = electron-builder --win nsis-web --x64
 */
const config = {
  appId: 'io.corsj.app',
  productName: 'corsj',
  directories: { output: 'release' },
  files: ['dist/**/*', 'package.json'],
  asar: true,
  win: {
    target: [{ target: 'nsis-web', arch: ['x64'] }],
  },
  nsisWeb: {
    oneClick: true,
    perMachine: false,
    deleteAppDataOnUninstall: false,
    runAfterFinish: true,
  },
  // nsis-web stub 下载 app.7z.001… 分卷的镜像地址（本地 dist:dir 先产出 web 安装器）
  publish: [{ provider: 'generic', url: 'https://downloads.corsj.invalid/win-x64' }],
  npmRebuild: false,
};
export default config;
