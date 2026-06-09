import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../services/api_service.dart';

const _historyKey = 'chat_history';

final _chatHistoryProvider =
    StateNotifierProvider<_ChatNotifier, List<Map<String, String>>>(
        (_) => _ChatNotifier());

class _ChatNotifier extends StateNotifier<List<Map<String, String>>> {
  _ChatNotifier() : super([]) {
    _load();
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_historyKey);
    if (raw != null) {
      state = (jsonDecode(raw) as List)
          .cast<Map<String, dynamic>>()
          .map((m) => m.map((k, v) => MapEntry(k, v.toString())))
          .toList();
    }
  }

  Future<void> add(Map<String, String> msg) async {
    state = [...state, msg];
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_historyKey, jsonEncode(state.take(200).toList()));
  }

  Future<void> clear() async {
    state = [];
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_historyKey);
  }
}

class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key});

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final _controller = TextEditingController();
  final _scroll = ScrollController();
  bool _sending = false;

  @override
  void dispose() {
    _controller.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(_scroll.position.maxScrollExtent,
            duration: const Duration(milliseconds: 280), curve: Curves.easeOut);
      }
    });
  }

  Future<void> _send() async {
    final text = _controller.text.trim();
    if (text.isEmpty || _sending) return;
    _controller.clear();
    setState(() => _sending = true);

    await ref.read(_chatHistoryProvider.notifier).add({'role': 'user', 'text': text});
    _scrollToBottom();

    try {
      final api = ref.read(apiServiceProvider);
      final res = await api.jarvisChat(text);
      final reply = (res['reply'] as String?) ?? 'Done.';
      await ref.read(_chatHistoryProvider.notifier).add({'role': 'jarvis', 'text': reply});
    } catch (e) {
      await ref.read(_chatHistoryProvider.notifier).add({'role': 'error', 'text': e.toString()});
    } finally {
      if (mounted) setState(() => _sending = false);
      _scrollToBottom();
    }
  }

  @override
  Widget build(BuildContext context) {
    final messages = ref.watch(_chatHistoryProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('AI Chat'),
        actions: [
          IconButton(
            icon: const Icon(Icons.delete_outline),
            tooltip: 'Clear history',
            onPressed: () => ref.read(_chatHistoryProvider.notifier).clear(),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: messages.isEmpty
                ? Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.chat_bubble_outline,
                            size: 48,
                            color: Theme.of(context).colorScheme.outlineVariant),
                        const SizedBox(height: 12),
                        Text('Ask Jarvis anything',
                            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                                color: Theme.of(context).colorScheme.outline)),
                      ],
                    ),
                  )
                : ListView.builder(
                    controller: _scroll,
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 16),
                    itemCount: messages.length,
                    itemBuilder: (context, i) {
                      final m = messages[i];
                      final role = m['role'] ?? 'system';
                      final text = m['text'] ?? '';
                      final isUser = role == 'user';
                      final isError = role == 'error';
                      final bg = isUser
                          ? Theme.of(context).colorScheme.primary
                          : isError
                              ? Theme.of(context).colorScheme.errorContainer
                              : Theme.of(context).colorScheme.surfaceContainerHighest;
                      final fg = isUser
                          ? Theme.of(context).colorScheme.onPrimary
                          : isError
                              ? Theme.of(context).colorScheme.onErrorContainer
                              : Theme.of(context).colorScheme.onSurface;
                      return Align(
                        alignment:
                            isUser ? Alignment.centerRight : Alignment.centerLeft,
                        child: Container(
                          margin: const EdgeInsets.symmetric(vertical: 4),
                          padding: const EdgeInsets.symmetric(
                              horizontal: 14, vertical: 10),
                          constraints: BoxConstraints(
                              maxWidth:
                                  MediaQuery.of(context).size.width * 0.78),
                          decoration: BoxDecoration(
                              color: bg,
                              borderRadius: BorderRadius.circular(14)),
                          child: Text(text,
                              style: TextStyle(color: fg, fontSize: 14)),
                        ),
                      );
                    },
                  ),
          ),
          const Divider(height: 1),
          Padding(
            padding: EdgeInsets.only(
              left: 12,
              right: 8,
              top: 8,
              bottom: MediaQuery.of(context).viewInsets.bottom + 8,
            ),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _controller,
                    textInputAction: TextInputAction.send,
                    onSubmitted: (_) => _send(),
                    decoration: const InputDecoration(
                      hintText: 'Ask Jarvis anything…',
                      border: OutlineInputBorder(),
                      contentPadding:
                          EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      isDense: true,
                    ),
                  ),
                ),
                const SizedBox(width: 6),
                _sending
                    ? const Padding(
                        padding: EdgeInsets.all(10),
                        child: SizedBox(
                            width: 22,
                            height: 22,
                            child: CircularProgressIndicator(strokeWidth: 2.5)),
                      )
                    : IconButton(
                        icon: const Icon(Icons.send),
                        onPressed: _send,
                        color: Theme.of(context).colorScheme.primary,
                      ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
