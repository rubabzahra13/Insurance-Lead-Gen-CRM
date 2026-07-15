'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { Video, Calendar, Send, FileText, CheckCircle, AlertTriangle, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { BRAND } from '../../../lib/brand';
import { COLORS, GRADIENT, RGBA } from '../../../lib/colors';

function getDaysInMonthGrid(dateObj) {
  const year = dateObj.getFullYear();
  const month = dateObj.getMonth();
  
  const firstDay = new Date(year, month, 1);
  const startDayOfWeek = firstDay.getDay();
  const numDays = new Date(year, month + 1, 0).getDate();
  
  const grid = [];
  
  // Previous month padding
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    grid.push({
      date: new Date(year, month, -i),
      isCurrentMonth: false
    });
  }
  
  // Current month days
  for (let i = 1; i <= numDays; i++) {
    grid.push({
      date: new Date(year, month, i),
      isCurrentMonth: true
    });
  }
  
  // Next month padding to fill grid
  const remaining = 7 - (grid.length % 7);
  if (remaining < 7) {
    for (let i = 1; i <= remaining; i++) {
      grid.push({
        date: new Date(year, month + 1, i),
        isCurrentMonth: false
      });
    }
  }
  
  return grid;
}

const TIME_SLOTS = [
  '9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM',
  '11:00 AM', '11:30 AM', '1:00 PM', '1:30 PM',
  '2:00 PM', '2:30 PM', '3:00 PM', '3:30 PM',
  '4:00 PM', '4:30 PM',
];

const INPUT_STYLE = {
  background: '#ffffff',
  border: `1px solid ${COLORS.lightBlue}`,
  borderRadius: '10px',
  padding: '12px 14px',
  color: COLORS.text,
  outline: 'none',
  transition: 'border-color 0.2s, box-shadow 0.2s',
  fontSize: '0.95rem',
  width: '100%',
};

const LANDING_VIDEO_ID = process.env.NEXT_PUBLIC_LANDING_VIDEO_YOUTUBE_ID || 'wRpsFyb_lp4';

export default function LandingPage() {
  const { leadId } = useParams();
  const [leadData, setLeadData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Form state
  const [formStarted, setFormStarted] = useState(false);
  const [formSubmitted, setFormSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    name: '', email: '', phone: '', city: '', experience: '',
  });

  // Calendar booking state
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedTime, setSelectedTime] = useState(null);
  const [bookingConfirmed, setBookingConfirmed] = useState(false);
  const [bookingSubmitting, setBookingSubmitting] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);

  useEffect(() => {
    if (!leadId) { setError(true); setLoading(false); return; }

    const isTestId = leadId === 'test123' || leadId === 'demo-lead' || leadId.toString().startsWith('test');

    const fetchLead = async () => {
      try {
        const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';
        const res = await fetch(`${apiBaseUrl}/api/avatar12/leads/${leadId}`);
        if (res.ok) {
          const data = await res.json();
          setLeadData(data);
          setFormData(prev => ({
            ...prev,
            name: data.name || '',
            email: data.contact_email || data.email || '',
            phone: data.contact_phone || data.phone || '',
          }));
          fetch(`${apiBaseUrl}/api/funnel-events/link_clicked`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lead_id: leadId }),
          }).catch(() => {});
        } else if (isTestId) {
          setLeadData({ id: leadId, name: 'Alex Johnson', email: 'alex.johnson@example.com', phone: '+1 (555) 019-2834', avatar_type: 'Avatar 1' });
          setFormData(prev => ({ ...prev, name: 'Alex Johnson', email: 'alex.johnson@example.com', phone: '+1 (555) 019-2834' }));
        } else { setError(true); }
      } catch {
        if (isTestId) {
          setLeadData({ id: leadId, name: 'Alex Johnson (Mock)', avatar_type: 'Avatar 1' });
        } else { setError(true); }
      } finally { setLoading(false); }
    };
    fetchLead();
  }, [leadId]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (!formStarted) {
      setFormStarted(true);
      const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';
      fetch(`${apiBaseUrl}/api/funnel-events/form_started`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: leadId }),
      }).catch(() => {});
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormSubmitted(true);
    const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';
    try {
      await fetch(`${apiBaseUrl}/api/funnel-events/form_submitted`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: leadId, payload: formData }),
      });
    } catch (err) { console.error("Failed to submit form event", err); }
  };

  const handleBookMeeting = async () => {
    if (!selectedDate || !selectedTime) return;
    setBookingSubmitting(true);
    const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';
    const dateStr = selectedDate.toISOString().split('T')[0];
    try {
      await fetch(`${apiBaseUrl}/api/funnel-events/meeting_booked`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id: leadId,
          payload: { date: dateStr, time: selectedTime, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }
        }),
      });
      setBookingConfirmed(true);
    } catch (err) { console.error("Failed to book meeting", err); }
    finally { setBookingSubmitting(false); }
  };



  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100vh', width: '100vw', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.white, color: COLORS.text }}>
        <p style={{ fontSize: '1.2rem', opacity: 0.7 }}>Loading opportunity portal...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', height: '100vh', width: '100vw', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.white, color: COLORS.text, padding: '24px', textAlign: 'center' }}>
        <div style={{ background: 'rgba(184, 107, 107, 0.06)', border: '1px solid rgba(184, 107, 107, 0.15)', padding: '32px', borderRadius: '16px', maxWidth: '480px' }}>
          <AlertTriangle size={48} style={{ color: COLORS.error, marginBottom: '16px' }} />
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '12px' }}>Link Expired or Invalid</h2>
          <p style={{ color: 'var(--text-secondary)', lineHeight: '1.6', marginBottom: '24px' }}>
            This invitation link is invalid or has expired. Please verify the URL or contact your recruiting agent for a new invite.
          </p>
          <a href="/" style={{ display: 'inline-block', background: COLORS.white, border: `1px solid ${COLORS.lightBlue}`, padding: '10px 20px', borderRadius: '8px', fontSize: '0.95rem', color: COLORS.text }}>
            Return to Dashboard
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="landing-page" style={{ backgroundColor: COLORS.white, color: COLORS.text, fontFamily: "'Outfit', sans-serif" }}>
      <div className="landing-page__inner">
        {/* Header */}
        <header className="landing-page__header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: GRADIENT, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff', fontWeight: 800 }}>{BRAND.logoInitials}</div>
            <span style={{ fontWeight: 700, fontSize: '1.2rem', letterSpacing: '-0.02em', color: COLORS.text }}>{BRAND.senderName}</span>
          </div>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', background: '#ffffff', padding: '6px 12px', borderRadius: '20px', border: `1px solid ${COLORS.lightBlue}` }}>
            Exclusive Opportunity
          </span>
        </header>

        {/* Content columns */}
        <div className="landing-page__grid">
          
          {/* Left Column: Info & Video */}
          <div>
            <h2 className="landing-page__hero-title" style={{ color: COLORS.text }}>
              Hi {leadData?.name ? leadData.name.split(' ')[0] : 'there'}, unlock your next career milestone.
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', lineHeight: 1.6, marginBottom: '32px' }}>
              We have identified you as a prime candidate for our high-growth insurance advisory team. Watch our 2-minute overview video below to see how we empower partners with warm leads and top-tier commissions.
            </p>

            {/* Video Container */}
            <div style={{ 
              position: 'relative', paddingTop: '56.25%',
              borderRadius: '16px', overflow: 'hidden', background: '#ffffff', 
              border: `1px solid ${COLORS.lightBlue}`, boxShadow: '0 4px 16px rgba(0,0,0,0.06)'
            }}>
              <iframe 
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 0 }}
                src={`https://www.youtube.com/embed/${LANDING_VIDEO_ID}`}
                title="Insurance Career Overview"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                allowFullScreen
              ></iframe>
            </div>
          </div>

          {/* Right Column: Form → Calendar Booking */}
          <div className="landing-page__form-card">
            {!formSubmitted ? (
              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                <div style={{ marginBottom: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: COLORS.oldRose, marginBottom: '8px' }}>
                    <FileText size={18} />
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Step 1 of 2</span>
                  </div>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Express Interest</h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '4px' }}>Confirm your contact details and background to proceed to calendar booking.</p>
                </div>

                {[
                  { label: 'Full Name', name: 'name', type: 'text', required: true },
                  { label: 'Email Address', name: 'email', type: 'email', required: true },
                  { label: 'Phone Number', name: 'phone', type: 'tel', required: true },
                  { label: 'Current City & State', name: 'city', type: 'text', required: true, placeholder: 'e.g. Dallas, TX' },
                ].map(field => (
                  <div key={field.name} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)' }}>{field.label}</label>
                    <input 
                      type={field.type} name={field.name} required={field.required}
                      placeholder={field.placeholder || ''}
                      value={formData[field.name]}
                      onChange={handleInputChange}
                      style={INPUT_STYLE}
                      onFocus={(e) => { e.target.style.borderColor = COLORS.neutral; e.target.style.boxShadow = '0 0 0 3px rgba(75,85,99,0.12)'; }}
                      onBlur={(e) => { e.target.style.borderColor = COLORS.lightBlue; e.target.style.boxShadow = 'none'; }}
                    />
                  </div>
                ))}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Summarize your past sales/insurance experience</label>
                  <textarea 
                    name="experience" rows="3" required
                    placeholder="Briefly describe your background..."
                    value={formData.experience}
                    onChange={handleInputChange}
                    style={{ ...INPUT_STYLE, resize: 'vertical' }}
                    onFocus={(e) => { e.target.style.borderColor = COLORS.neutral; e.target.style.boxShadow = '0 0 0 3px rgba(75,85,99,0.12)'; }}
                    onBlur={(e) => { e.target.style.borderColor = COLORS.lightBlue; e.target.style.boxShadow = 'none'; }}
                  ></textarea>
                </div>

                <button 
                  type="submit" 
                  style={{ 
                    background: GRADIENT, 
                    color: '#ffffff', fontWeight: 700, border: 'none', borderRadius: '10px', 
                    padding: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', gap: '8px',
                    boxShadow: '0 4px 14px rgba(75, 85, 99, 0.12)', marginTop: '6px', fontSize: '1rem'
                  }}
                >
                  Continue to Booking <Send size={16} />
                </button>
              </form>
            ) : bookingConfirmed ? (
              /* Booking Confirmation */
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '16px', padding: '32px 0' }}>
                <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: RGBA.neutral06, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <CheckCircle size={32} style={{ color: COLORS.success }} />
                </div>
                <h3 style={{ fontSize: '1.4rem', fontWeight: 700 }}>Meeting Confirmed!</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: 1.6, maxWidth: '360px' }}>
                  You're booked for <strong>{selectedDate?.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</strong> at <strong>{selectedTime}</strong>.
                  You'll receive a calendar invite shortly.
                </p>
                <div style={{ background: COLORS.white, border: `1px solid ${COLORS.lightBlue}`, borderRadius: '12px', padding: '16px 24px', display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px' }}>
                  <Calendar size={20} style={{ color: COLORS.oldRose }} />
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{selectedDate?.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>{selectedTime} · 15 min intro call</div>
                  </div>
                </div>
              </div>
            ) : (
              /* Interactive Calendar Booking */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: COLORS.success, marginBottom: '8px' }}>
                    <CheckCircle size={18} />
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Step 2 of 2</span>
                  </div>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Pick a Day & Time</h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '4px' }}>Choose a convenient slot for a 15-minute introductory call.</p>
                </div>

                {/* Compact Date Picker Widget */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Select Date</label>
                  <div style={{ position: 'relative' }}>
                    <button
                      type="button"
                      onClick={() => setShowDatePicker(!showDatePicker)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '12px 14px',
                        border: `1px solid ${COLORS.lightBlue}`,
                        borderRadius: '10px',
                        background: '#ffffff',
                        color: COLORS.text,
                        fontSize: '0.95rem',
                        cursor: 'pointer',
                        width: '100%',
                        textAlign: 'left',
                        justifyContent: 'space-between',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Calendar size={18} style={{ color: COLORS.oldRose }} />
                        {selectedDate ? selectedDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'Choose a date...'}
                      </span>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{showDatePicker ? '▲' : '▼'}</span>
                    </button>

                    {showDatePicker && (
                      <div style={{
                        position: 'absolute',
                        top: 'calc(100% + 8px)',
                        left: 0,
                        right: 0,
                        zIndex: 50,
                        background: '#ffffff',
                        border: `1px solid ${COLORS.lightBlue}`,
                        borderRadius: '14px',
                        padding: '16px',
                        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                        minWidth: '280px',
                      }}>
                        {/* Month Header Navigation */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                          <button
                            type="button"
                            onClick={() => {
                              const newMonth = new Date(currentMonth);
                              newMonth.setMonth(newMonth.getMonth() - 1);
                              setCurrentMonth(newMonth);
                            }}
                            style={{
                              background: COLORS.white,
                              border: 'none',
                              borderRadius: '6px',
                              padding: '6px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <ChevronLeft size={16} />
                          </button>
                          <span style={{ fontWeight: 700, fontSize: '0.95rem', color: COLORS.text }}>
                            {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const newMonth = new Date(currentMonth);
                              newMonth.setMonth(newMonth.getMonth() + 1);
                              setCurrentMonth(newMonth);
                            }}
                            style={{
                              background: COLORS.white,
                              border: 'none',
                              borderRadius: '6px',
                              padding: '6px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <ChevronRight size={16} />
                          </button>
                        </div>

                        {/* Days of Week Headers */}
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(7, 1fr)',
                          gap: '4px',
                          textAlign: 'center',
                          fontWeight: 600,
                          fontSize: '0.75rem',
                          color: 'var(--text-muted)',
                          marginBottom: '8px',
                        }}>
                          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => <span key={d}>{d}</span>)}
                        </div>

                        {/* Month Days Grid */}
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(7, 1fr)',
                          gap: '4px',
                        }}>
                          {getDaysInMonthGrid(currentMonth).map(({ date, isCurrentMonth }, idx) => {
                            const isToday = date.toDateString() === new Date().toDateString();
                            const isPast = date < today;
                            const isSelected = selectedDate && date.toDateString() === selectedDate.toDateString();
                            
                            return (
                              <button
                                key={idx}
                                type="button"
                                disabled={isPast}
                                onClick={() => {
                                  setSelectedDate(date);
                                  setSelectedTime(null);
                                  setShowDatePicker(false);
                                }}
                                style={{
                                  padding: '8px 0',
                                  border: 'none',
                                  borderRadius: '8px',
                                  background: isSelected
                                    ? COLORS.neutral
                                    : isToday
                                    ? RGBA.neutral06
                                    : 'transparent',
                                  color: isSelected
                                    ? '#ffffff'
                                    : isPast
                                    ? '#cbd5e1'
                                    : isCurrentMonth
                                    ? COLORS.text
                                    : COLORS.lightBlue,
                                  fontWeight: isSelected || isToday ? 700 : 500,
                                  fontSize: '0.85rem',
                                  cursor: isPast ? 'not-allowed' : 'pointer',
                                  transition: 'all 0.15s ease',
                                  outline: 'none',
                                }}
                              >
                                {date.getDate()}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Time Slots */}
                {selectedDate && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
                      <Clock size={14} style={{ color: 'var(--text-secondary)' }} />
                      <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        Available times for {selectedDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                    <div className="landing-time-slots">
                      {TIME_SLOTS.map(slot => {
                        const isSelected = selectedTime === slot;
                        return (
                          <button
                            key={slot}
                            onClick={() => setSelectedTime(slot)}
                            style={{
                              padding: '10px 8px',
                              borderRadius: '8px',
                              cursor: 'pointer',
                              background: isSelected ? COLORS.neutral : '#ffffff',
                              border: isSelected ? `1px solid ${COLORS.neutral}` : `1px solid ${COLORS.lightBlue}`,
                              color: isSelected ? '#ffffff' : COLORS.text,
                              fontWeight: isSelected ? 700 : 500,
                              fontSize: '0.85rem',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            {slot}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Confirm Button */}
                <button 
                  onClick={handleBookMeeting}
                  disabled={!selectedDate || !selectedTime || bookingSubmitting}
                  style={{ 
                    background: (!selectedDate || !selectedTime) ? COLORS.lightBlue : GRADIENT, 
                    color: (!selectedDate || !selectedTime) ? COLORS.lightBlue : '#ffffff', 
                    fontWeight: 700, border: 'none', borderRadius: '10px', 
                    padding: '14px', cursor: (!selectedDate || !selectedTime) ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    boxShadow: (selectedDate && selectedTime) ? '0 4px 14px rgba(15, 118, 110, 0.18)' : 'none',
                    marginTop: '4px', fontSize: '1rem', transition: 'all 0.2s ease',
                    width: '100%'
                  }}
                >
                  {bookingSubmitting ? 'Confirming...' : 'Confirm Booking'} <Calendar size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
