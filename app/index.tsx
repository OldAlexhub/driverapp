import { Redirect } from 'expo-router';

export default function RootRedirect() {
  // Declarative redirect to the splash route. Using <Redirect/> avoids
  // attempting programmatic navigation before the root layout mounts.
  return <Redirect href="/splash" />;
}
