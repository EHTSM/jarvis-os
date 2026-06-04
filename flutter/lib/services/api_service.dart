import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

import 'auth_service.dart';

// Override in .env / build config for different envs
const String _baseUrl = String.fromEnvironment(
  'API_URL',
  defaultValue: 'https://app.ooplix.com',
);

final apiServiceProvider = Provider<ApiService>((ref) {
  return ApiService(ref.read(authServiceProvider));
});

class ApiException implements Exception {
  final int statusCode;
  final String message;
  const ApiException(this.statusCode, this.message);
  @override
  String toString() => 'ApiException($statusCode): $message';
}

class ApiService {
  final AuthService _auth;
  const ApiService(this._auth);

  Future<Map<String, String>> _headers() async {
    final token = await _auth.getIdToken();
    return {
      'Content-Type': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
    };
  }

  Future<dynamic> get(String path, {Map<String, String>? query}) async {
    final uri = Uri.parse('$_baseUrl$path').replace(queryParameters: query);
    final resp = await http.get(uri, headers: await _headers());
    return _handle(resp);
  }

  Future<dynamic> post(String path, {Map<String, dynamic>? body}) async {
    final uri = Uri.parse('$_baseUrl$path');
    final resp = await http.post(
      uri,
      headers: await _headers(),
      body: body != null ? jsonEncode(body) : null,
    );
    return _handle(resp);
  }

  Future<dynamic> patch(String path, {Map<String, dynamic>? body}) async {
    final uri = Uri.parse('$_baseUrl$path');
    final resp = await http.patch(
      uri,
      headers: await _headers(),
      body: body != null ? jsonEncode(body) : null,
    );
    return _handle(resp);
  }

  Future<dynamic> delete(String path) async {
    final uri = Uri.parse('$_baseUrl$path');
    final resp = await http.delete(uri, headers: await _headers());
    return _handle(resp);
  }

  dynamic _handle(http.Response resp) {
    final data = jsonDecode(resp.body);
    if (resp.statusCode >= 200 && resp.statusCode < 300) return data;
    final msg = data is Map ? (data['error'] ?? data['message'] ?? 'Unknown') : resp.body;
    throw ApiException(resp.statusCode, msg.toString());
  }

  // ── JARVIS-specific endpoints ────────────────────────────────────

  Future<Map<String, dynamic>> jarvisChat(String input) async {
    return (await post('/jarvis', body: {'input': input})) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> getBillingStatus() async {
    return (await get('/billing/status')) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> getHealth() async {
    return (await get('/health')) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> listTasks() async {
    return (await get('/tasks')) as Map<String, dynamic>;
  }
}
