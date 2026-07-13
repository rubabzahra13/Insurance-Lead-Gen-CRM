import './globals.css';
import { BRAND } from '../lib/brand';

export const metadata = {
  title: BRAND.fullName,
  description: BRAND.tagline,
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
