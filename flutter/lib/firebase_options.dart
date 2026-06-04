// GENERATED FILE — do not edit manually.
// Run: flutterfire configure  (after adding Firebase project)
// Docs: https://firebase.google.com/docs/flutter/setup

import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb, TargetPlatform;

class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) return web;
    switch (defaultTargetPlatform) {
      case TargetPlatform.android: return android;
      case TargetPlatform.iOS:     return ios;
      default:
        throw UnsupportedError('DefaultFirebaseOptions have not been configured for ${defaultTargetPlatform.name}');
    }
  }

  // ── Replace these values after running `flutterfire configure` ──────────────
  // These are placeholder values — the app will not connect to Firebase until
  // you replace them with your real project values.

  static const FirebaseOptions android = FirebaseOptions(
    apiKey:            'REPLACE_WITH_ANDROID_API_KEY',
    appId:             'REPLACE_WITH_ANDROID_APP_ID',
    messagingSenderId: 'REPLACE_WITH_SENDER_ID',
    projectId:         'REPLACE_WITH_PROJECT_ID',
    storageBucket:     'REPLACE_WITH_PROJECT_ID.appspot.com',
  );

  static const FirebaseOptions ios = FirebaseOptions(
    apiKey:            'REPLACE_WITH_IOS_API_KEY',
    appId:             'REPLACE_WITH_IOS_APP_ID',
    messagingSenderId: 'REPLACE_WITH_SENDER_ID',
    projectId:         'REPLACE_WITH_PROJECT_ID',
    storageBucket:     'REPLACE_WITH_PROJECT_ID.appspot.com',
    iosClientId:       'REPLACE_WITH_IOS_CLIENT_ID',
    iosBundleId:       'com.ooplix.jarvis',
  );

  static const FirebaseOptions web = FirebaseOptions(
    apiKey:            'REPLACE_WITH_WEB_API_KEY',
    appId:             'REPLACE_WITH_WEB_APP_ID',
    messagingSenderId: 'REPLACE_WITH_SENDER_ID',
    projectId:         'REPLACE_WITH_PROJECT_ID',
    authDomain:        'REPLACE_WITH_PROJECT_ID.firebaseapp.com',
    storageBucket:     'REPLACE_WITH_PROJECT_ID.appspot.com',
  );
}
