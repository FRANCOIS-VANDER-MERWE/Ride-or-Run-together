// The /auto entry of react-native-url-polyfill ships no type
// declarations. It installs URL and URLSearchParams globals, which
// @supabase/supabase-js needs on React Native.
declare module 'react-native-url-polyfill/auto';
