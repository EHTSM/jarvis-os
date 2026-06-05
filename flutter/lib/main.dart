import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'firebase_options.dart';
import 'router.dart';
import 'theme.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Firebase init is guarded — will be activated after flutterfire configure is run.
  // Build compiles and runs without Firebase until google-services.json is in place.
  try {
    await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  } catch (_) {
    // Firebase not configured yet — app runs in offline/no-auth mode.
  }
  runApp(const ProviderScope(child: JarvisApp()));
}

class JarvisApp extends ConsumerWidget {
  const JarvisApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: 'JARVIS',
      debugShowCheckedModeBanner: false,
      theme: JarvisTheme.light,
      darkTheme: JarvisTheme.dark,
      themeMode: ThemeMode.system,
      routerConfig: router,
    );
  }
}
