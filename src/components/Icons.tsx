import React from 'react';
import Svg, {
  Path,
  Circle,
  Rect,
  Line,
  Polyline,
  Polygon,
} from 'react-native-svg';

export interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

function BaseIcon({
  size = 16,
  color = '#FFFFFF',
  strokeWidth = 2,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </Svg>
  );
}

export function Activity(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </BaseIcon>
  );
}

export function Bike(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Circle cx="18.5" cy="17.5" r="3.5" />
      <Circle cx="5.5" cy="17.5" r="3.5" />
      <Circle cx="15" cy="5" r="1" />
      <Path d="M12 17.5V14l-3-3 4-3 2 3h2" />
    </BaseIcon>
  );
}

export function Footprints(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z" />
      <Path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z" />
    </BaseIcon>
  );
}

export function Gauge(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Path d="m12 14 4-4" />
      <Path d="M3.34 19a10 10 0 1 1 17.32 0" />
    </BaseIcon>
  );
}

export function Clock(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Circle cx="12" cy="12" r="10" />
      <Polyline points="12 6 12 12 16 14" />
    </BaseIcon>
  );
}

export function Percent(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Line x1="19" y1="5" x2="5" y2="19" />
      <Circle cx="6.5" cy="6.5" r="2.5" />
      <Circle cx="17.5" cy="17.5" r="2.5" />
    </BaseIcon>
  );
}

export function Radio(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />
      <Path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" />
      <Circle cx="12" cy="12" r="2" />
      <Path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" />
      <Path d="M19.1 4.9C23 8.8 23 15.1 19.1 19" />
    </BaseIcon>
  );
}

export function Music2(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Circle cx="8" cy="18" r="4" />
      <Path d="M12 18V2l7 4" />
    </BaseIcon>
  );
}

export function Music(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Path d="M9 18V5l12-2v13" />
      <Circle cx="6" cy="18" r="3" />
      <Circle cx="18" cy="16" r="3" />
    </BaseIcon>
  );
}

export function Layers(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Polygon points="12 2 2 7 12 12 22 7 12 2" />
      <Polyline points="2 17 12 22 22 17" />
      <Polyline points="2 12 12 17 22 12" />
    </BaseIcon>
  );
}

export function Play(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Polygon points="6 3 20 12 6 21 6 3" />
    </BaseIcon>
  );
}

export function Pause(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Rect x="14" y="4" width="4" height="16" rx="1" />
      <Rect x="6" y="4" width="4" height="16" rx="1" />
    </BaseIcon>
  );
}

export function RotateCcw(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <Path d="M3 3v5h5" />
    </BaseIcon>
  );
}

export function ShieldAlert(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <Path d="M12 8v4" />
      <Path d="M12 16h.01" />
    </BaseIcon>
  );
}

export function ShieldCheck(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <Path d="m9 12 2 2 4-4" />
    </BaseIcon>
  );
}

export function Heart(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    </BaseIcon>
  );
}

export function Zap(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </BaseIcon>
  );
}

export function Map(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z" />
      <Path d="M15 5.764v15" />
      <Path d="M9 3.236v15" />
    </BaseIcon>
  );
}

export function MapPin(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
      <Circle cx="12" cy="10" r="3" />
    </BaseIcon>
  );
}

export function Mic(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <Path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <Line x1="12" y1="19" x2="12" y2="22" />
    </BaseIcon>
  );
}

export function MicOff(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Line x1="2" y1="2" x2="22" y2="22" />
      <Path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2" />
      <Path d="M5 10v2a7 7 0 0 0 12 5" />
      <Path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
      <Path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
      <Line x1="12" y1="19" x2="12" y2="22" />
    </BaseIcon>
  );
}

export function Waves(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
      <Path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
      <Path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
    </BaseIcon>
  );
}

export function Navigation(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Polygon points="3 11 22 2 13 21 11 13 3 11" />
    </BaseIcon>
  );
}

export function ChevronRight(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Path d="m9 18 6-6-6-6" />
    </BaseIcon>
  );
}

export function Smartphone(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
      <Path d="M12 18h.01" />
    </BaseIcon>
  );
}

export function AlertTriangle(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <Path d="M12 9v4" />
      <Path d="M12 17h.01" />
    </BaseIcon>
  );
}

export function CheckCircle2(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Circle cx="12" cy="12" r="10" />
      <Path d="m9 12 2 2 4-4" />
    </BaseIcon>
  );
}

export function Wind(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2" />
      <Path d="M9.6 4.6A2 2 0 1 1 11 8H2" />
      <Path d="M12.6 19.4A2 2 0 1 0 14 16H2" />
    </BaseIcon>
  );
}

export function Sparkles(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
    </BaseIcon>
  );
}

export function Flag(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <Line x1="4" y1="22" x2="4" y2="15" />
    </BaseIcon>
  );
}

export function Thermometer(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z" />
    </BaseIcon>
  );
}

export function Compass(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Circle cx="12" cy="12" r="10" />
      <Polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
    </BaseIcon>
  );
}

export function PlusCircle(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Circle cx="12" cy="12" r="10" />
      <Path d="M8 12h8" />
      <Path d="M12 8v8" />
    </BaseIcon>
  );
}

export function Mountain(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Path d="m8 3 4 8 5-5 5 15H2L8 3z" />
    </BaseIcon>
  );
}

export function Eye(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <Circle cx="12" cy="12" r="3" />
    </BaseIcon>
  );
}

export function Volume2(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <Path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <Path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </BaseIcon>
  );
}

export function VolumeX(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <Line x1="22" y1="9" x2="16" y2="15" />
      <Line x1="16" y1="9" x2="22" y2="15" />
    </BaseIcon>
  );
}

export function Send(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Path d="m22 2-7 20-4-9-9-4Z" />
      <Path d="M22 2 11 13" />
    </BaseIcon>
  );
}

export function Users(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <Circle cx="9" cy="7" r="4" />
      <Path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <Path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </BaseIcon>
  );
}

export function SkipForward(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Polygon points="5 4 15 12 5 20 5 4" />
      <Line x1="19" y1="5" x2="19" y2="19" />
    </BaseIcon>
  );
}

export function SkipBack(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Polygon points="19 20 9 12 19 4 19 20" />
      <Line x1="5" y1="19" x2="5" y2="5" />
    </BaseIcon>
  );
}

export function RefreshCw(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <Path d="M21 3v5h-5" />
      <Path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <Path d="M8 16H3v5" />
    </BaseIcon>
  );
}

export function Code2(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Path d="m18 16 4-4-4-4" />
      <Path d="m6 8-4 4 4 4" />
      <Path d="m14.5 4-5 16" />
    </BaseIcon>
  );
}

export function ArrowRight(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Path d="M5 12h14" />
      <Path d="m12 5 7 7-7 7" />
    </BaseIcon>
  );
}

export function Cpu(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Rect width="16" height="16" x="4" y="4" rx="2" />
      <Rect width="6" height="6" x="9" y="9" rx="1" />
      <Path d="M15 2v2" />
      <Path d="M15 20v2" />
      <Path d="M2 15h2" />
      <Path d="M2 9h2" />
      <Path d="M20 15h2" />
      <Path d="M20 9h2" />
      <Path d="M9 2v2" />
      <Path d="M9 20v2" />
    </BaseIcon>
  );
}

export function Database(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Path d="M3 5c0-1.66 4.03-3 9-3s9 1.34 9 3-4.03 3-9 3-9-1.34-9-3Z" />
      <Path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
      <Path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3" />
    </BaseIcon>
  );
}

export function Server(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Rect width="20" height="8" x="2" y="2" rx="2" ry="2" />
      <Rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
      <Line x1="6" y1="6" x2="6.01" y2="6" />
      <Line x1="6" y1="18" x2="6.01" y2="18" />
    </BaseIcon>
  );
}

export function KeyRound(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" />
      <Circle cx="16.5" cy="7.5" r=".5" />
    </BaseIcon>
  );
}

export function GitBranch(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Line x1="6" y1="3" x2="6" y2="15" />
      <Circle cx="18" cy="6" r="3" />
      <Circle cx="6" cy="18" r="3" />
      <Path d="M18 9a9 9 0 0 1-9 9" />
    </BaseIcon>
  );
}

export function Copy(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <Path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </BaseIcon>
  );
}

export function Check(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <Path d="M20 6 9 17l-5-5" />
    </BaseIcon>
  );
}
