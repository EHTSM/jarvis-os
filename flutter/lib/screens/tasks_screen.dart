import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/api_service.dart';

final _tasksProvider = FutureProvider.autoDispose<List<dynamic>>((ref) async {
  final api = ref.read(apiServiceProvider);
  final res = await api.listTasks();
  final items = res['tasks'] ?? res['data'] ?? [];
  return items is List ? items : [];
});

class TasksScreen extends ConsumerStatefulWidget {
  const TasksScreen({super.key});

  @override
  ConsumerState<TasksScreen> createState() => _TasksScreenState();
}

class _TasksScreenState extends ConsumerState<TasksScreen> {
  final _inputController = TextEditingController();
  bool _dispatching = false;
  String? _lastResult;

  @override
  void dispose() {
    _inputController.dispose();
    super.dispose();
  }

  Future<void> _dispatch() async {
    final text = _inputController.text.trim();
    if (text.isEmpty || _dispatching) return;
    setState(() { _dispatching = true; _lastResult = null; });
    try {
      final api = ref.read(apiServiceProvider);
      final res = await api.jarvisChat(text);
      final reply = (res['reply'] as String?) ?? 'Task dispatched.';
      setState(() { _lastResult = reply; _inputController.clear(); });
      ref.invalidate(_tasksProvider);
    } catch (e) {
      setState(() => _lastResult = 'Error: $e');
    } finally {
      if (mounted) setState(() => _dispatching = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tasksAsync = ref.watch(_tasksProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Tasks'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.invalidate(_tasksProvider),
          ),
        ],
      ),
      body: Column(
        children: [
          // Dispatch bar
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _inputController,
                    textInputAction: TextInputAction.send,
                    onSubmitted: (_) => _dispatch(),
                    decoration: const InputDecoration(
                      hintText: 'Dispatch a task…',
                      border: OutlineInputBorder(),
                      contentPadding:
                          EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      isDense: true,
                    ),
                  ),
                ),
                const SizedBox(width: 6),
                _dispatching
                    ? const Padding(
                        padding: EdgeInsets.all(10),
                        child: SizedBox(
                            width: 22,
                            height: 22,
                            child: CircularProgressIndicator(strokeWidth: 2.5)),
                      )
                    : IconButton(
                        icon: const Icon(Icons.play_arrow),
                        onPressed: _dispatch,
                        color: Theme.of(context).colorScheme.primary,
                      ),
              ],
            ),
          ),
          if (_lastResult != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 4, 12, 4),
              child: Container(
                width: double.infinity,
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: Theme.of(context)
                      .colorScheme
                      .surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(_lastResult!,
                    style: Theme.of(context).textTheme.bodySmall),
              ),
            ),
          const Divider(),
          Expanded(
            child: tasksAsync.when(
              loading: () =>
                  const Center(child: CircularProgressIndicator()),
              error: (e, _) => Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.error_outline,
                        color: Theme.of(context).colorScheme.error, size: 36),
                    const SizedBox(height: 8),
                    Text('Could not load tasks',
                        style: Theme.of(context).textTheme.bodyMedium),
                    const SizedBox(height: 4),
                    Text(e.toString(),
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: Theme.of(context).colorScheme.outline),
                        textAlign: TextAlign.center),
                  ],
                ),
              ),
              data: (tasks) => tasks.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.task_alt,
                              size: 48,
                              color: Theme.of(context)
                                  .colorScheme
                                  .outlineVariant),
                          const SizedBox(height: 12),
                          Text('No tasks yet',
                              style: Theme.of(context)
                                  .textTheme
                                  .bodyMedium
                                  ?.copyWith(
                                      color: Theme.of(context)
                                          .colorScheme
                                          .outline)),
                          const SizedBox(height: 4),
                          Text('Dispatch a task above to see it here',
                              style: Theme.of(context)
                                  .textTheme
                                  .bodySmall
                                  ?.copyWith(
                                      color: Theme.of(context)
                                          .colorScheme
                                          .outline)),
                        ],
                      ),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.all(12),
                      itemCount: tasks.length,
                      separatorBuilder: (_, __) =>
                          const SizedBox(height: 8),
                      itemBuilder: (context, i) {
                        final t = tasks[i];
                        final id =
                            t is Map ? (t['id']?.toString() ?? '#${i + 1}') : '#${i + 1}';
                        final title = t is Map
                            ? (t['title'] ?? t['input'] ?? t['type'] ?? 'Task')
                                .toString()
                            : t.toString();
                        final status = t is Map
                            ? (t['status'] ?? 'pending').toString()
                            : 'unknown';
                        final statusColor = status == 'completed'
                            ? Colors.green
                            : status == 'failed'
                                ? Colors.red
                                : status == 'running'
                                    ? Colors.orange
                                    : Theme.of(context)
                                        .colorScheme
                                        .outline;
                        return Card(
                          child: ListTile(
                            leading: CircleAvatar(
                              radius: 14,
                              backgroundColor:
                                  statusColor.withOpacity(0.15),
                              child: Icon(
                                status == 'completed'
                                    ? Icons.check
                                    : status == 'failed'
                                        ? Icons.close
                                        : Icons.hourglass_empty,
                                size: 16,
                                color: statusColor,
                              ),
                            ),
                            title: Text(title,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                    fontSize: 14,
                                    fontWeight: FontWeight.w500)),
                            subtitle: Text(id,
                                style: Theme.of(context)
                                    .textTheme
                                    .bodySmall),
                            trailing: Chip(
                              label: Text(status,
                                  style: TextStyle(
                                      fontSize: 11, color: statusColor)),
                              side: BorderSide(
                                  color: statusColor.withOpacity(0.3)),
                              backgroundColor:
                                  statusColor.withOpacity(0.08),
                              padding: EdgeInsets.zero,
                              materialTapTargetSize:
                                  MaterialTapTargetSize.shrinkWrap,
                            ),
                          ),
                        );
                      },
                    ),
            ),
          ),
        ],
      ),
    );
  }
}
