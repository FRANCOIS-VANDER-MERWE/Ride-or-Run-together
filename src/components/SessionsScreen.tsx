import React, { useEffect, useRef, useState } from 'react';
import {
  BackHandler, Keyboard, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Activity, Bike, ChevronRight, Footprints, KeyRound, Layers, PlusCircle } from './Icons';
import type { ActivityMode } from '../data/sessionData';
import { createHostPreview, findSampleSession, SAMPLE_SESSIONS } from '../data/sessionPreview';
import type { SampleSession } from '../data/sessionPreview';

type Screen = 'entry' | 'create' | 'code' | 'details' | 'lobby';
type Lobby = { session: SampleSession; host: boolean; ready: boolean };

const MONO_FONT = Platform.select({ ios: 'Menlo', default: 'monospace' });
const accent = (mode: ActivityMode) => mode === 'run' ? '#D4FF00' : '#00F0FF';

function Button({ label, onPress, secondary = false, disabled = false }: {
  label: string; onPress: () => void; secondary?: boolean; disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} aria-disabled={disabled} disabled={disabled}
    onPress={onPress} style={({ pressed }) => [styles.button, secondary && styles.secondaryButton, (disabled || pressed) && styles.dimmed]}>
    <Text style={[styles.buttonText, secondary && styles.secondaryButtonText]}>{label}</Text>
  </Pressable>;
}

function Participant({ name, role, ready, self = false }: { name: string; role: string; ready: boolean; self?: boolean }) {
  return <View style={styles.participant}>
    <View style={styles.avatar}><Text style={[styles.avatarText, { color: self ? '#D4FF00' : '#00F0FF' }]}>{name[0]}</Text></View>
    <View style={styles.participantInfo}><Text style={styles.participantName}>{name}</Text><Text style={styles.small}>{role}</Text></View>
    <Text style={[styles.readiness, ready && styles.ready]}>{ready ? 'Ready' : 'Not ready'}</Text>
  </View>;
}

export default function SessionsScreen({ active, onOpenStackSpec }: { active: boolean; onOpenStackSpec: () => void }) {
  const [screen, setScreen] = useState<Screen>('entry');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<ActivityMode>('run');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<SampleSession>(SAMPLE_SESSIONS[0]);
  const [detailsOrigin, setDetailsOrigin] = useState<'entry' | 'code'>('entry');
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const nameInput = useRef<React.ComponentRef<typeof TextInput>>(null);
  const codeInput = useRef<React.ComponentRef<typeof TextInput>>(null);

  const go = (next: Screen) => {
    Keyboard.dismiss();
    setError('');
    setScreen(next);
    scroll.current?.scrollTo({ y: 0, animated: false });
  };
  const back = () => go(screen === 'lobby' ? (lobby?.host ? 'create' : 'details') : screen === 'details' ? detailsOrigin : 'entry');

  useEffect(() => {
    if (!active || screen === 'entry') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => subscription.remove();
  }, [active, screen, detailsOrigin, lobby?.host]);

  const showDetails = (sample: SampleSession, origin: 'entry' | 'code') => {
    setSelected(sample);
    setDetailsOrigin(origin);
    go('details');
  };
  const previewHost = () => {
    const session = createHostPreview(name, mode);
    if (!session) { setError('Enter a session name between 1 and 40 characters.'); nameInput.current?.focus(); return; }
    setLobby((previous) => ({ session, host: true, ready: previous?.host && previous.session.name === session.name && previous.session.mode === mode ? previous.ready : false }));
    go('lobby');
  };
  const reviewCode = () => {
    const sample = findSampleSession(code);
    if (!sample) { setError(code.trim() ? 'No matching sample. Try RUN123 or RIDE12.' : 'Enter a sample code.'); codeInput.current?.focus(); return; }
    showDetails(sample, 'code');
  };
  const previewGuest = () => {
    if (selected.status !== 'available') return;
    setLobby((previous) => ({ session: selected, host: false, ready: previous && !previous.host && previous.session.code === selected.code ? previous.ready : false }));
    go('lobby');
  };
  const route = SAMPLE_SESSIONS[mode === 'run' ? 0 : 1];

  // Keep this component mounted across tabs so preview state stays local and survives navigation.
  if (!active) return null;

  return <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={styles.header}>
      <View style={styles.brand}><View style={styles.logo}><Activity size={20} color="#080B10" strokeWidth={2.5} /></View><Text style={styles.wordmark}>PACELOCK</Text></View>
      <Text style={styles.badge}>UI PREVIEW</Text>
    </View>
    <View style={styles.notice}><Text style={styles.small}><Text style={styles.lime}>Sample data only.</Text> Nothing is created or joined.</Text></View>
    <ScrollView ref={scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
      {screen !== 'entry' && <Pressable accessibilityRole="button" onPress={back} style={styles.back}>
        <View style={styles.backIcon}><ChevronRight size={14} color="#94A3B8" /></View>
        <Text style={styles.bodyMuted}>{screen === 'lobby' ? (lobby?.host ? 'Edit sample setup' : 'Back to details') : screen === 'details' ? 'Back' : 'Back to Sessions'}</Text>
      </Pressable>}

      {screen === 'entry' && <>
        <View style={styles.section}><Text style={styles.eyebrow}>RIDE OR RUN TOGETHER</Text><Text accessibilityRole="header" style={styles.title}>Sessions</Text><Text style={styles.bodyMuted}>Explore how your next group outing could begin.</Text></View>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" onPress={() => go('create')} style={[styles.card, styles.actionCard, styles.hostAction]}><PlusCircle size={24} color="#D4FF00" /><Text style={styles.actionTitle}>Create sample{ '\n' }session</Text><Text style={styles.eyebrow}>PREVIEW AS HOST</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => go('code')} style={[styles.card, styles.actionCard]}><KeyRound size={24} color="#00F0FF" /><Text style={styles.actionTitle}>Explore with{ '\n' }sample code</Text><Text style={styles.eyebrow}>PREVIEW AS GUEST</Text></Pressable>
        </View>
        <Text style={styles.eyebrow}>TRY A SAMPLE</Text>
        {SAMPLE_SESSIONS.slice(0, 2).map((sample) => <Pressable key={sample.code} accessibilityRole="button" accessibilityLabel={`Review ${sample.name} sample`} onPress={() => showDetails(sample, 'entry')} style={styles.card}>
          <View style={styles.row}><Text style={[styles.badge, { color: accent(sample.mode) }]}>{sample.mode.toUpperCase()} · SAMPLE</Text><ChevronRight size={15} color="#94A3B8" /></View>
          <Text style={styles.cardTitle}>{sample.name}</Text><Text style={styles.bodyMuted}>{sample.route} · {sample.distance}</Text>
          <View style={styles.cardFooter}><Text style={[styles.metric, { color: accent(sample.mode) }]}>{sample.target}</Text><Text style={styles.small}>{sample.participantCount} sample participants</Text></View>
        </Pressable>)}
        <Pressable accessibilityRole="button" onPress={() => { Keyboard.dismiss(); onOpenStackSpec(); }} style={styles.stackLink}><View style={styles.brand}><Layers size={16} color="#94A3B8" /><Text style={styles.bodyMuted}>Stack Spec</Text></View><ChevronRight size={15} color="#94A3B8" /></Pressable>
      </>}

      {screen === 'create' && <>
        <View style={styles.section}><Text style={styles.eyebrow}>SAMPLE SETUP</Text><Text accessibilityRole="header" style={styles.title}>Create a sample</Text><Text style={styles.bodyMuted}>See the lobby from a host’s perspective.</Text></View>
        <View style={styles.card}>
          <View style={styles.section}><Text style={styles.label}>Session name</Text><TextInput ref={nameInput} accessibilityLabel="Session name" value={name} onChangeText={(value) => { setName(value); setError(''); }} maxLength={40} placeholder="e.g. Saturday easy run" placeholderTextColor="#64748B" style={styles.input} returnKeyType="done" onSubmitEditing={previewHost} /><Text style={styles.small}>Up to 40 characters. Used only in this preview.</Text>{error !== '' && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}</View>
          <View style={styles.section}><Text style={styles.label}>Activity</Text><View style={styles.modeTrack}>{(['run', 'ride'] as const).map((value) => {
            const Icon = value === 'run' ? Footprints : Bike;
            return <Pressable key={value} accessibilityRole="button" accessibilityLabel={value === 'run' ? 'Run' : 'Ride'} accessibilityState={{ selected: mode === value }} aria-pressed={mode === value} onPress={() => setMode(value)} style={[styles.modeButton, mode === value && { backgroundColor: accent(value) }]}><Icon size={16} color={mode === value ? '#080B10' : '#94A3B8'} /><Text style={[styles.modeLabel, mode === value && styles.modeLabelActive]}>{value === 'run' ? 'Run' : 'Ride'}</Text></Pressable>;
          })}</View></View>
          <View style={styles.section}><Text style={styles.label}>Sample route</Text><View style={styles.routePreset}><Text style={styles.body}>{route.route} · {route.distance}</Text></View><Text style={[styles.metric, { color: accent(mode) }]}>Sample {mode === 'run' ? 'pace' : 'speed'} · {route.target}</Text></View>
          <Button label="Preview host lobby" onPress={previewHost} />
        </View><Text style={styles.small}>You’ll be the only participant. No invitations are sent.</Text>
      </>}

      {screen === 'code' && <>
        <View style={styles.section}><Text style={styles.eyebrow}>SAMPLE LOOKUP</Text><Text accessibilityRole="header" style={styles.title}>Explore with a code</Text><Text style={styles.bodyMuted}>Review an example before opening its lobby.</Text></View>
        <View style={styles.card}><View style={styles.section}><Text style={styles.label}>Sample code</Text><TextInput ref={codeInput} accessibilityLabel="Sample code" value={code} onChangeText={(value) => { setCode(value); setError(''); }} maxLength={20} autoCapitalize="characters" autoCorrect={false} placeholder="RUN123" placeholderTextColor="#64748B" style={[styles.input, styles.codeInput]} returnKeyType="go" onSubmitEditing={reviewCode} /><Text style={styles.small}>Try RUN123 or RIDE12. These are preset examples.</Text>{error !== '' && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}</View><Button label="Review sample" onPress={reviewCode} /></View>
        <View style={styles.card}><Text style={styles.eyebrow}>OTHER EXAMPLE STATES</Text><Text style={styles.bodyMuted}>FULL12 shows a full group.{ '\n' }ENDED1 shows an ended session.</Text><Text style={styles.small}>No real codes are checked.</Text></View>
      </>}

      {screen === 'details' && <>
        <View style={styles.section}><Text style={styles.eyebrow}>REVIEW BEFORE PREVIEWING</Text><Text accessibilityRole="header" style={styles.title}>Sample details</Text></View>
        <View style={styles.card}><View style={styles.row}><Text style={[styles.badge, { color: accent(selected.mode) }]}>{selected.mode.toUpperCase()} · SAMPLE</Text><Text style={styles.badge}>{selected.status.toUpperCase()}</Text></View><Text style={styles.cardTitle}>{selected.name}</Text><Text style={styles.bodyMuted}>{selected.route} · {selected.distance} · {selected.target}</Text><View style={styles.cardFooter}><View style={styles.participantInfo}><Text style={styles.eyebrow}>SAMPLE HOST</Text><Text style={styles.body}>Alex</Text></View><View style={styles.participantInfo}><Text style={styles.eyebrow}>PARTICIPANTS</Text><Text style={styles.body}>{selected.participantCount} sample participants</Text></View></View><Text style={styles.small}>Sample code: {selected.code}</Text></View>
        <Text style={styles.bodyMuted}>{selected.status === 'full' ? 'This sample group is full. Choose another example.' : selected.status === 'ended' ? 'This sample session has ended. Choose another example.' : 'Opening this preview adds a local You row. It does not join a real session.'}</Text>
        <Button label="Preview guest lobby" onPress={previewGuest} disabled={selected.status !== 'available'} />
      </>}

      {screen === 'lobby' && lobby && <>
        <View style={styles.row}><Text accessibilityRole="header" style={styles.title}>Sample lobby</Text><Text style={styles.badge}>{lobby.host ? 'HOST' : 'GUEST'} PREVIEW</Text></View>
        <View style={styles.card}><Text style={[styles.badge, styles.alignStart, { color: accent(lobby.session.mode) }]}>{lobby.session.mode.toUpperCase()} · SAMPLE</Text><Text style={styles.cardTitle}>{lobby.session.name}</Text><Text style={styles.bodyMuted}>{lobby.session.route} · {lobby.session.distance} · {lobby.session.target}</Text><View style={styles.codeBlock}><Text style={styles.eyebrow}>SAMPLE CODE · NOT SHAREABLE</Text><Text style={styles.codeValue}>{lobby.session.code}</Text></View></View>
        <View style={styles.card}><View style={styles.row}><Text style={styles.cardTitle}>Participants</Text><Text style={styles.badge}>{lobby.host ? 1 : 3} total</Text></View>
          {!lobby.host && <><Participant name="Alex" role="Sample host" ready /><Participant name="Maya" role="Sample participant" ready={false} /></>}
          <Participant name="You" role={lobby.host ? 'Sample host' : 'Sample guest'} self ready={lobby.ready} />
        </View>
        <Pressable accessibilityRole="switch" accessibilityLabel="My sample readiness" accessibilityState={{ checked: lobby.ready }} aria-checked={lobby.ready} onPress={() => setLobby({ ...lobby, ready: !lobby.ready })} style={styles.button}><Text style={styles.buttonText}>{lobby.ready ? 'Mark me not ready' : 'Mark me ready'}</Text></Pressable>
        <Text style={styles.small}>Only your preview changes. Readiness does not mean connected.</Text><Button label="Leave preview" secondary onPress={() => { setLobby(null); go('entry'); }} /><Text style={[styles.small, styles.center]}>Refresh clears this local preview.</Text>
      </>}
    </ScrollView>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080B10' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, gap: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 38, height: 38, backgroundColor: '#D4FF00', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  wordmark: { fontSize: 16, fontWeight: '900', color: '#FFFFFF', letterSpacing: -0.3 },
  notice: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' },
  content: { padding: 14, paddingBottom: 28, gap: 14, width: '100%', maxWidth: 560, alignSelf: 'center' },
  section: { gap: 8 },
  title: { color: '#FFFFFF', fontSize: 24, fontWeight: '900', letterSpacing: -0.6, flexShrink: 1 },
  eyebrow: { fontFamily: MONO_FONT, fontSize: 10, color: '#94A3B8', letterSpacing: 0.6 },
  body: { fontSize: 14, lineHeight: 21, color: '#FFFFFF' },
  bodyMuted: { fontSize: 14, lineHeight: 21, color: '#94A3B8' },
  small: { fontSize: 12, lineHeight: 18, color: '#94A3B8' },
  lime: { color: '#D4FF00' },
  badge: { fontFamily: MONO_FONT, fontSize: 10, color: '#94A3B8', paddingHorizontal: 6, paddingVertical: 4, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  actions: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  card: { backgroundColor: '#0E131D', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderRadius: 18, padding: 14, gap: 14 },
  actionCard: { flex: 1, gap: 12 },
  hostAction: { borderColor: 'rgba(212,255,0,0.3)' },
  actionTitle: { fontSize: 14, lineHeight: 21, fontWeight: '800', color: '#FFFFFF' },
  cardTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', flexShrink: 1 },
  cardFooter: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  metric: { fontSize: 12, lineHeight: 18, fontFamily: MONO_FONT },
  stackLink: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  back: { minHeight: 44, flexDirection: 'row', gap: 6, alignItems: 'center' },
  backIcon: { transform: [{ rotate: '180deg' }] },
  label: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  input: { minHeight: 48, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', backgroundColor: '#080B10', color: '#FFFFFF', fontSize: 16 },
  codeInput: { fontFamily: MONO_FONT },
  error: { color: '#FB7185', fontSize: 13, lineHeight: 19 },
  modeTrack: { flexDirection: 'row', padding: 4, gap: 4, backgroundColor: '#111726', borderRadius: 14 },
  modeButton: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10 },
  modeLabel: { fontWeight: '800', fontSize: 14, color: '#94A3B8' },
  modeLabelActive: { color: '#080B10' },
  routePreset: { padding: 12, borderRadius: 12, backgroundColor: '#080B10', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  button: { backgroundColor: '#D4FF00', minHeight: 48, padding: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 14, fontWeight: '800', color: '#080B10', textAlign: 'center' },
  secondaryButton: { backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  secondaryButtonText: { color: '#FFFFFF' },
  dimmed: { opacity: 0.5 },
  codeBlock: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: 12, gap: 8 },
  codeValue: { color: '#FFFFFF', fontSize: 16, fontFamily: MONO_FONT },
  participant: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#111726', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: MONO_FONT, fontSize: 12, fontWeight: '700' },
  participantInfo: { flex: 1, gap: 4 },
  participantName: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  readiness: { color: '#94A3B8', fontSize: 12, fontFamily: MONO_FONT },
  ready: { color: '#34D399' },
  alignStart: { alignSelf: 'flex-start' },
  center: { textAlign: 'center' },
});
