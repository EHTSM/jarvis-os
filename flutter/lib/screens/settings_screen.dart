import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../services/auth_service.dart';
import '../services/api_service.dart';

final _settingsStatusProvider =
    FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  final api = ref.read(apiServiceProvider);
  try {
    final res = await api.get('/settings/status');
    return res is Map<String, dynamic> ? res : {};
  } catch (_) {
    return {};
  }
});

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authStateProvider);
    final statusAsync = ref.watch(_settingsStatusProvider);
    final user = authState.valueOrNull;

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.symmetric(vertical: 8),
        children: [
          // ── Account ─────────────────────────────────────────────────
          _SectionHeader(label: 'Account'),
          ListTile(
            leading: CircleAvatar(
              backgroundColor:
                  Theme.of(context).colorScheme.primaryContainer,
              child: Text(
                user?.email?.isNotEmpty == true
                    ? user!.email![0].toUpperCase()
                    : '?',
                style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: Theme.of(context).colorScheme.onPrimaryContainer),
              ),
            ),
            title: Text(user?.email ?? 'Unknown',
                style: const TextStyle(fontWeight: FontWeight.w600)),
            subtitle: const Text('Operator account'),
          ),
          const Divider(),

          // ── Service connections ──────────────────────────────────────
          _SectionHeader(label: 'Service Connections'),
          statusAsync.when(
            loading: () => const Padding(
              padding: EdgeInsets.symmetric(vertical: 16),
              child: Center(child: CircularProgressIndicator()),
            ),
            error: (_, __) => const ListTile(
              leading: Icon(Icons.warning_amber_outlined, color: Colors.orange),
              title: Text('Could not load settings status'),
              subtitle: Text('Backend may be offline'),
            ),
            data: (status) {
              final wa = status['whatsapp'] as Map?;
              final rp = status['razorpay'] as Map?;
              return Column(children: [
                _ServiceTile(
                  icon: Icons.chat_outlined,
                  name: 'WhatsApp Business',
                  connected: wa?['configured'] == true,
                  detail: wa?['configured'] == true
                      ? 'Connected — phone ID configured'
                      : 'Not configured — set WA_TOKEN in .env',
                ),
                _ServiceTile(
                  icon: Icons.payments_outlined,
                  name: 'Razorpay',
                  connected: rp?['configured'] == true,
                  detail: rp?['configured'] == true
                      ? 'API key configured'
                      : 'Not configured — set RAZORPAY_KEY_ID in .env',
                ),
              ]);
            },
          ),
          const Divider(),

          // ── App info ─────────────────────────────────────────────────
          _SectionHeader(label: 'App'),
          const ListTile(
            leading: Icon(Icons.info_outline),
            title: Text('Version'),
            trailing: Text('1.0.0', style: TextStyle(fontSize: 13)),
          ),
          ListTile(
            leading: const Icon(Icons.open_in_browser_outlined),
            title: const Text('Web app'),
            subtitle: const Text('app.ooplix.com'),
            onTap: () {},
          ),
          const Divider(),

          // ── Sign out ─────────────────────────────────────────────────
          _SectionHeader(label: 'Session'),
          ListTile(
            leading: const Icon(Icons.logout, color: Colors.red),
            title: const Text('Sign out',
                style: TextStyle(
                    color: Colors.red, fontWeight: FontWeight.w600)),
            onTap: () async {
              final confirm = await showDialog<bool>(
                context: context,
                builder: (_) => AlertDialog(
                  title: const Text('Sign out'),
                  content: const Text('Are you sure you want to sign out?'),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(context, false),
                        child: const Text('Cancel')),
                    TextButton(
                        onPressed: () => Navigator.pop(context, true),
                        child: const Text('Sign out',
                            style: TextStyle(color: Colors.red))),
                  ],
                ),
              );
              if (confirm == true) {
                await ref.read(authServiceProvider).signOut();
                if (context.mounted) context.go('/login');
              }
            },
          ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String label;
  const _SectionHeader({required this.label});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
      child: Text(
        label.toUpperCase(),
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: Theme.of(context).colorScheme.outline,
              letterSpacing: 0.8,
            ),
      ),
    );
  }
}

class _ServiceTile extends StatelessWidget {
  final IconData icon;
  final String name;
  final bool connected;
  final String detail;
  const _ServiceTile(
      {required this.icon,
      required this.name,
      required this.connected,
      required this.detail});

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon,
          color: connected ? Colors.green : Theme.of(context).colorScheme.outline),
      title: Text(name, style: const TextStyle(fontWeight: FontWeight.w500)),
      subtitle: Text(detail,
          style: Theme.of(context)
              .textTheme
              .bodySmall
              ?.copyWith(color: Theme.of(context).colorScheme.outline)),
      trailing: Icon(
        connected ? Icons.check_circle : Icons.radio_button_unchecked,
        color: connected ? Colors.green : Theme.of(context).colorScheme.outlineVariant,
        size: 20,
      ),
    );
  }
}
