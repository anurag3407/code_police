import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { z } from 'zod';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const contactSchema = z.object({
  name: z.string().min(2, "Name is too short"),
  email: z.string().email("Invalid email address"),
  subject: z.string().optional(),
  message: z.string().min(10, "Message is too short"),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const validatedData = contactSchema.parse(body);

    const contactEmail = process.env.CONTACT_EMAIL_ADDRESS || 'contact@codepolice.com';
    const fromEmail = process.env.FROM_EMAIL_ADDRESS || 'onboarding@resend.dev'; // Resend requires a verified domain or their onboarding email

    if (resend) {
      await resend.emails.send({
        from: `Code Police <${fromEmail}>`,
        to: contactEmail,
        subject: `New Contact Form Submission: ${validatedData.subject || 'No Subject'}`,
        text: `Name: ${validatedData.name}\nEmail: ${validatedData.email}\nSubject: ${validatedData.subject || 'N/A'}\nMessage:\n${validatedData.message}`,
        replyTo: validatedData.email,
      });
    } else {
      // Mock for when API key is missing (like in local dev)
      console.log('Mock email sent (RESEND_API_KEY missing):', validatedData);
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: 'Invalid form data', details: error.errors }, { status: 400 });
    }
    
    console.error('Email sending failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to send email' }, { status: 500 });
  }
}
