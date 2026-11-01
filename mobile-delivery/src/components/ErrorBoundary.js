import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import AppButton from './AppButton';
import { colors, spacing, type } from '../theme';

// App-level safety net: a render error shows a recoverable screen instead of a blank app.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    // No remote logging is configured. Never log tokens or customer data here.
    if (__DEV__) console.warn('[ErrorBoundary]', error?.message);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <View style={styles.wrap}>
        <Text style={type.title}>Something went wrong</Text>
        <Text style={[type.small, styles.text]}>The screen could not be displayed. Your data on the server is unchanged.</Text>
        <AppButton title="Try again" onPress={() => this.setState({ hasError: false })} />
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.lg, backgroundColor: colors.background },
  text: { lineHeight: 19 },
});
