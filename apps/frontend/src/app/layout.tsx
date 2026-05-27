export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, background: '#0b0b0b', color: '#f5f5f5', fontFamily: 'system-ui, sans-serif' }}>{children}</body>
    </html>
  );
}
