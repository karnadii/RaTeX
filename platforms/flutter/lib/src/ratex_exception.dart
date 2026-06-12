class RaTeXException implements Exception {
  final String message;
  const RaTeXException(this.message);
  @override
  String toString() => 'RaTeXException: $message';
}
