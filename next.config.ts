import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // postgres パッケージはサーバーサイドでのみ動作する
  serverExternalPackages: ['postgres'],
};

export default nextConfig;
