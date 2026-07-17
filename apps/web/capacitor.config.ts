import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.ascuita',
  appName: 'Ascuita',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      showSpinner: false,
    },
    StatusBar: {
      overlaysWebView: false,
    },
    FirebaseAuthentication: {
      providers: ['google.com'],
    },
  },
};

export default config;
