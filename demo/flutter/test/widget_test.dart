// ignore_for_file: avoid_relative_lib_imports, unused_import

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../lib/main.dart';

void main() {
  testWidgets('RaTeX demo app smoke test', (WidgetTester tester) async {
    // Build our app and trigger a frame.
    await tester.pumpWidget(const RaTeXDemoApp());

    // Verify that the title is rendered.
    expect(find.text('RaTeX Demo'), findsOneWidget);
  });
}
