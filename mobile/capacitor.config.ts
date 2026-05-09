import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId:    "com.jarvisai.app",
  appName:  "JARVIS AI",
  webDir:   "build",

  plugins: {
    SplashScreen: {
      launchShowDuration:       2000,
      backgroundColor:          "#0a0a0f",
      androidSplashResourceName:"splash",
      showSpinner:              false
    },
    StatusBar: {
      style:           "DARK",
      backgroundColor: "#0a0a0f"
    },
    Keyboard: {
      resize:        "body",
      style:         "DARK",
      resizeOnFullScreen: true
    }
  },

  android: {
    buildOptions: {
      keystorePath:  "jarvis-release.keystore",
      keystoreAlias: "jarvis"
    }
  }
};

export default config;
