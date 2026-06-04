import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../services/auth_service.dart';
import '../services/api_service.dart';

// Provider for billing/health data
final dashboardDataProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  final api = ref.read(apiServiceProvider);
  final results = await Future.wait([
    api.getBillingStatus().catchError((_) => <String, dynamic>{}),
    api.getHealth().catchError((_) => <String, dynamic>{}),
  ]);
  return {
    'billing': results[0],
    'health':  results[1],
  };
});

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authStateProvider);
    final data      = ref.watch(dashboardDataProvider);
    final user      = authState.valueOrNull;

    return Scaffold(
      appBar: AppBar(
        title: const Text('JARVIS'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.invalidate(dashboardDataProvider),
          ),
          PopupMenuButton<String>(
            onSelected: (v) async {
              if (v == 'logout') {
                await ref.read(authServiceProvider).signOut();
                if (context.mounted) context.go('/login');
              }
            },
            itemBuilder: (_) => [
              PopupMenuItem(
                value: 'logout',
                child: Row(children: const [
                  Icon(Icons.logout, size: 18),
                  SizedBox(width: 8),
                  Text('Sign out'),
                ]),
              ),
            ],
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(dashboardDataProvider),
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // User card
            _UserCard(email: user?.email ?? 'Unknown'),
            const SizedBox(height: 16),
            // Status cards
            data.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, _) => _ErrorCard(message: e.toString()),
              data: (d) => Column(children: [
                _StatusCard(
                  title: 'Billing',
                  icon: Icons.credit_card,
                  value: (d['billing'] as Map?)?['plan']?.toString() ?? 'Unknown',
                  subtitle: 'Plan status',
                  color: Colors.green,
                ),
                const SizedBox(height: 12),
                _StatusCard(
                  title: 'Server',
                  icon: Icons.cloud_done,
                  value: (d['health'] as Map?)?['status']?.toString() ?? 'Checking...',
                  subtitle: 'Backend health',
                  color: Colors.blue,
                ),
              ]),
            ),
            const SizedBox(height: 24),
            Text('Quick Actions', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600)),
            const SizedBox(height: 12),
            _ActionGrid(),
          ],
        ),
      ),
    );
  }
}

class _UserCard extends StatelessWidget {
  final String email;
  const _UserCard({required this.email});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: Theme.of(context).colorScheme.primaryContainer,
          child: Text(email.isNotEmpty ? email[0].toUpperCase() : '?',
              style: const TextStyle(fontWeight: FontWeight.bold)),
        ),
        title: const Text('Operator', style: TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text(email, style: Theme.of(context).textTheme.bodySmall),
      ),
    );
  }
}

class _StatusCard extends StatelessWidget {
  final String title, value, subtitle;
  final IconData icon;
  final Color color;
  const _StatusCard({required this.title, required this.icon, required this.value, required this.subtitle, required this.color});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: Icon(icon, color: color),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text(subtitle),
        trailing: Chip(label: Text(value, style: const TextStyle(fontSize: 12))),
      ),
    );
  }
}

class _ErrorCard extends StatelessWidget {
  final String message;
  const _ErrorCard({required this.message});

  @override
  Widget build(BuildContext context) {
    return Card(
      color: Theme.of(context).colorScheme.errorContainer,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Text(message, style: TextStyle(color: Theme.of(context).colorScheme.onErrorContainer)),
      ),
    );
  }
}

class _ActionGrid extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final actions = [
      (Icons.chat_bubble_outline, 'AI Chat',    '/chat'),
      (Icons.task_alt,            'Tasks',       '/tasks'),
      (Icons.analytics_outlined,  'Metrics',     '/metrics'),
      (Icons.settings_outlined,   'Settings',    '/settings'),
    ];
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      crossAxisSpacing: 12,
      mainAxisSpacing: 12,
      childAspectRatio: 1.4,
      children: actions.map((a) => _ActionTile(icon: a.$1, label: a.$2, route: a.$3)).toList(),
    );
  }
}

class _ActionTile extends StatelessWidget {
  final IconData icon;
  final String label, route;
  const _ActionTile({required this.icon, required this.label, required this.route});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: InkWell(
        onTap: () => context.go(route),
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 28, color: Theme.of(context).colorScheme.primary),
              const SizedBox(height: 8),
              Text(label, style: const TextStyle(fontWeight: FontWeight.w500)),
            ],
          ),
        ),
      ),
    );
  }
}
