import * as WebBrowser from 'expo-web-browser';

import './global.css';

import App from './src/App';

// Required for OAuth on web: when Spotify redirects back into the auth
// popup, the app loads inside that popup, and this call is what detects
// it, hands the auth result to the opener window, and closes the popup.
// Without it the popup just runs the full app and sign-in never
// completes. No-op on native.
WebBrowser.maybeCompleteAuthSession();

export default App;
