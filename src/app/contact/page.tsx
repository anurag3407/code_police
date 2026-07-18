"use client";

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';

const contactSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  subject: z.string().optional(),
  message: z.string().min(10, "Message must be at least 10 characters"),
});

type ContactFormData = z.infer<typeof contactSchema>;

export default function ContactPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ContactFormData>({
    resolver: zodResolver(contactSchema),
  });

  const onSubmit = async (data: ContactFormData) => {
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (response.ok) {
        toast.success("Message sent successfully!");
        reset();
      } else {
        toast.error(result.error || "Failed to send message. Please try again.");
      }
    } catch (error) {
      toast.error("An unexpected error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen pt-24 pb-12 flex flex-col items-center justify-center bg-zinc-950 text-zinc-50 px-4">
      <div className="max-w-xl w-full p-8 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-xl">
        <h1 className="text-3xl font-bold mb-2 text-center">Contact Us</h1>
        <p className="text-zinc-400 text-center mb-8">
          Have questions or feedback? Fill out the form below and we'll get back to you shortly.
        </p>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="flex flex-col space-y-2">
            <label htmlFor="name" className="text-sm font-medium text-zinc-300">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              id="name"
              type="text"
              {...register('name')}
              className="px-4 py-2 bg-zinc-950 border border-zinc-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-700 text-zinc-100 placeholder:text-zinc-600"
              placeholder="Your name"
            />
            {errors.name && <span className="text-red-400 text-xs">{errors.name.message}</span>}
          </div>

          <div className="flex flex-col space-y-2">
            <label htmlFor="email" className="text-sm font-medium text-zinc-300">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              id="email"
              type="email"
              {...register('email')}
              className="px-4 py-2 bg-zinc-950 border border-zinc-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-700 text-zinc-100 placeholder:text-zinc-600"
              placeholder="you@example.com"
            />
            {errors.email && <span className="text-red-400 text-xs">{errors.email.message}</span>}
          </div>

          <div className="flex flex-col space-y-2">
            <label htmlFor="subject" className="text-sm font-medium text-zinc-300">
              Subject
            </label>
            <input
              id="subject"
              type="text"
              {...register('subject')}
              className="px-4 py-2 bg-zinc-950 border border-zinc-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-700 text-zinc-100 placeholder:text-zinc-600"
              placeholder="How can we help?"
            />
          </div>

          <div className="flex flex-col space-y-2">
            <label htmlFor="message" className="text-sm font-medium text-zinc-300">
              Message <span className="text-red-500">*</span>
            </label>
            <textarea
              id="message"
              {...register('message')}
              rows={5}
              className="px-4 py-2 bg-zinc-950 border border-zinc-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-700 text-zinc-100 placeholder:text-zinc-600 resize-none"
              placeholder="Write your message here..."
            />
            {errors.message && <span className="text-red-400 text-xs">{errors.message.message}</span>}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 px-4 bg-white text-black font-semibold rounded-lg hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center"
          >
            {isSubmitting ? (
              <span className="flex items-center space-x-2">
                <svg className="animate-spin h-5 w-5 text-black" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>Sending...</span>
              </span>
            ) : (
              "Send Message"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
