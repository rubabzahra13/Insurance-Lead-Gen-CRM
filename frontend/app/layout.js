import './globals.css';

export const metadata = {
  title: 'Lead Scout CRM',
  description: 'AI-powered multi-channel insurance recruitment & outreach platform',
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
