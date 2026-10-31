// App-level and page-level error boundary (web PageErrorBoundary). A screen crash shows a recoverable message,
// never a blank screen. The error text is shown without stack traces.
import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './ui';

export default class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch() { /* no logging of user data in release builds */ }
  reset = () => { this.setState({ error: null }); this.props.onReset?.(); };
  render() {
    if (!this.state.error) return this.props.children;
    const message = String(this.state.error?.message || 'Unknown error').split('\n')[0].slice(0, 300);
    return <ScrollView contentContainerStyle={styles.wrap}>
      <View style={styles.card} accessibilityRole="alert">
        <Text style={styles.title}>{this.props.app ? 'Something went wrong' : 'Something went wrong on this page'}</Text>
        <Text style={styles.body}>Your data is safe. Try again. If it keeps happening, share this message with support:</Text>
        <Text style={styles.message}>{message}</Text>
        <Pressable accessibilityRole="button" onPress={this.reset} style={styles.button}><Text style={styles.buttonText}>Try again</Text></Pressable>
      </View>
    </ScrollView>;
  }
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: 'center', padding: 16 },
  card: { padding: 20, borderWidth: 1, borderColor: '#fecaca', borderRadius: 14, backgroundColor: '#fff' },
  title: { fontSize: 18, fontWeight: '700', color: '#0f172a', marginBottom: 8 },
  body: { color: '#475569', fontSize: 14, marginBottom: 12, lineHeight: 20 },
  message: { padding: 10, borderRadius: 8, backgroundColor: '#fef2f2', color: '#991b1b', fontSize: 13, marginBottom: 16 },
  button: { minHeight: 44, paddingHorizontal: 16, borderRadius: 10, backgroundColor: '#0f766e', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  buttonText: { color: '#fff', fontWeight: '700' },
});
