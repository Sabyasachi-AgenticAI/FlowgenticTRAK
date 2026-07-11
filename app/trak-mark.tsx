// Voicepoint — the FlowgenticTRAK mark. A map pin (tracking) whose head is
// an audio waveform (the voice agent). Ink outline, orange signal.
export function TrakMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path
        d="M16 3.5C11.2 3.5 7.5 7.4 7.5 12.2C7.5 18.8 14.5 25.8 15.5 26.8a0.75 0.75 0 0 0 1 0C18 25.8 24.5 18.8 24.5 12.2C24.5 7.4 20.8 3.5 16 3.5Z"
        stroke="#0F1F33"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <rect x="11.7" y="10" width="2" height="4.4" rx="1" fill="#E8590C" />
      <rect x="15" y="8.2" width="2" height="8" rx="1" fill="#E8590C" />
      <rect x="18.3" y="10" width="2" height="4.4" rx="1" fill="#E8590C" />
    </svg>
  )
}
