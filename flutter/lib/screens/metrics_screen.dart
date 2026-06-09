import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/api_service.dart';

final _metricsProvider =
    FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  final api = ref.read(apiServiceProvider);
  final results = await Future.wait([
    api.get('/stats').catchError((_) => <String, dynamic>{}),
    api.get('/ops').catchError((_) => <String, dynamic>{}),
    api.get('/metrics').catchError((_) => <String, dynamic>{}),
  ]);
  return {
    'stats':   results[0] is Map ? results[0] as Map<String, dynamic> : {},
    'ops':     results[1] is Map ? results[1] as Map<String, dynamic> : {},
    'metrics': results[2] is Map ? results[2] as Map<String, dynamic> : {},
  };
});

class MetricsScreen extends ConsumerWidget {
  const MetricsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(_metricsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Metrics'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.invalidate(_metricsProvider),
          ),
        ],
      ),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.error_outline,
                  color: Theme.of(context).colorScheme.error, size: 36),
              const SizedBox(height: 8),
              Text('Could not load metrics',
                  style: Theme.of(context).textTheme.bodyMedium),
              const SizedBox(height: 4),
              Text(e.toString(),
                  style: Theme.of(context).textTheme.bodySmall,
                  textAlign: TextAlign.center),
            ],
          ),
        ),
        data: (data) {
          final stats   = data['stats']   as Map<String, dynamic>;
          final ops     = data['ops']     as Map<String, dynamic>;
          final metrics = data['metrics'] as Map<String, dynamic>;

          final cards = <_MetricCard>[
            _MetricCard(
              icon: Icons.people_outline,
              label: 'Total leads',
              value: _fmt(stats['total'] ?? stats['leads']),
              color: Colors.blue,
            ),
            _MetricCard(
              icon: Icons.local_fire_department_outlined,
              label: 'Hot leads',
              value: _fmt(stats['hot']),
              color: Colors.orange,
            ),
            _MetricCard(
              icon: Icons.payments_outlined,
              label: 'Paid clients',
              value: _fmt(stats['paid']),
              color: Colors.green,
            ),
            _MetricCard(
              icon: Icons.currency_rupee,
              label: 'Revenue',
              value: stats['revenue'] != null
                  ? '₹${_fmt(stats['revenue'])}'
                  : '—',
              color: Colors.green,
            ),
            _MetricCard(
              icon: Icons.send_outlined,
              label: 'Messages sent',
              value: _fmt(
                  ops['automation'] is Map
                      ? (ops['automation'] as Map)
                          .values
                          .fold<int>(
                              0,
                              (s, d) =>
                                  s + ((d as Map?)?['sent'] as int? ?? 0))
                      : null),
              color: Colors.purple,
            ),
            _MetricCard(
              icon: Icons.bolt_outlined,
              label: 'Tasks run',
              value: _fmt(metrics['tasksRun'] ?? metrics['total_tasks'] ?? ops['tasksRun']),
              color: Colors.teal,
            ),
            _MetricCard(
              icon: Icons.check_circle_outline,
              label: 'System status',
              value: (ops['status'] as String?)?.toUpperCase() ?? '—',
              color: ops['status'] == 'ok' ? Colors.green : Colors.orange,
            ),
            _MetricCard(
              icon: Icons.memory_outlined,
              label: 'Queue depth',
              value: ops['queue'] is Map
                  ? _fmt((ops['queue'] as Map)['total'])
                  : '—',
              color: Colors.indigo,
            ),
          ];

          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(_metricsProvider),
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Text('Business Metrics',
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
                        ?.copyWith(fontWeight: FontWeight.w700)),
                const SizedBox(height: 12),
                GridView.count(
                  crossAxisCount: 2,
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  crossAxisSpacing: 12,
                  mainAxisSpacing: 12,
                  childAspectRatio: 1.55,
                  children: cards.map((c) => _MetricTile(card: c)).toList(),
                ),
                if (ops['services'] is Map) ...[
                  const SizedBox(height: 24),
                  Text('Service Health',
                      style: Theme.of(context)
                          .textTheme
                          .titleMedium
                          ?.copyWith(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 10),
                  ...(ops['services'] as Map).entries.map((e) => Card(
                        child: ListTile(
                          dense: true,
                          leading: Icon(
                            e.value == true
                                ? Icons.check_circle
                                : Icons.cancel,
                            color: e.value == true ? Colors.green : Colors.red,
                            size: 20,
                          ),
                          title: Text(e.key.toString(),
                              style: const TextStyle(
                                  fontSize: 13,
                                  fontWeight: FontWeight.w500)),
                          trailing: Text(
                            e.value == true ? 'online' : 'offline',
                            style: TextStyle(
                                fontSize: 12,
                                color: e.value == true
                                    ? Colors.green
                                    : Colors.red),
                          ),
                        ),
                      )),
                ],
              ],
            ),
          );
        },
      ),
    );
  }

  static String _fmt(dynamic v) {
    if (v == null) return '—';
    if (v is int) return v.toString();
    if (v is double) return v.toStringAsFixed(0);
    return v.toString();
  }
}

class _MetricCard {
  final IconData icon;
  final String label;
  final String value;
  final Color color;
  const _MetricCard(
      {required this.icon,
      required this.label,
      required this.value,
      required this.color});
}

class _MetricTile extends StatelessWidget {
  final _MetricCard card;
  const _MetricTile({required this.card});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Icon(card.icon, color: card.color, size: 18),
              const SizedBox(width: 6),
              Expanded(
                child: Text(card.label,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: Theme.of(context).colorScheme.outline),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis),
              ),
            ]),
            const Spacer(),
            Text(card.value,
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w800, color: card.color)),
          ],
        ),
      ),
    );
  }
}
