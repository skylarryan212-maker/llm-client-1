"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";

interface LocationPermissionModalProps {
  onClose: () => void;
}

export function LocationPermissionModal({ onClose }: LocationPermissionModalProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Animate in after mount
    setTimeout(() => setIsVisible(true), 50);
  }, []);

  const handleAllow = async () => {
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
        });
      });

      const { latitude, longitude } = position.coords;

      // Reverse geocode to get city name
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`
        );
        const data = await response.json();
        const city = data.address?.city || data.address?.town || data.address?.village || "Unknown";
        const state = data.address?.state || "";
        const country = data.address?.country || "";

        const locationString = [city, state, country].filter(Boolean).join(", ");

        // Store in localStorage
        localStorage.setItem("location_preference", "always");
        localStorage.setItem("location_data", JSON.stringify({
          lat: latitude,
          lng: longitude,
          city: locationString,
          timestamp: Date.now(),
        }));

        console.log("[Location] Permission granted, stored:", locationString);
      } catch (geocodeError) {
        console.error("[Location] Geocoding failed:", geocodeError);
        // Store coordinates even if geocoding fails
        localStorage.setItem("location_preference", "always");
        localStorage.setItem("location_data", JSON.stringify({
          lat: latitude,
          lng: longitude,
          city: `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`,
          timestamp: Date.now(),
        }));
      }

      setIsVisible(false);
      setTimeout(onClose, 300);
    } catch (error) {
      console.error("[Location] Permission denied or error:", error);
      localStorage.setItem("location_preference", "denied");
      setIsVisible(false);
      setTimeout(onClose, 300);
    }
  };

  const handleAllowWhileUsing = () => {
    localStorage.setItem("location_preference", "while_using");
    handleAllow(); // Same as "Always" for web apps
  };

  const handleNever = () => {
    localStorage.setItem("location_preference", "never");
    console.log("[Location] User selected Never");
    setIsVisible(false);
    setTimeout(onClose, 300);
  };

  const handleClose = () => {
    // Don't set any preference - will ask again next time
    console.log("[Location] User dismissed without choosing");
    setIsVisible(false);
    setTimeout(onClose, 300);
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
      onClick={handleClose}
    >
      <div
        className={`relative w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 shadow-2xl border border-zinc-200 dark:border-zinc-800 transition-all duration-300 ${
          isVisible ? "scale-100 opacity-100" : "scale-95 opacity-0"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Content */}
        <div className="p-6 pt-8">
          <div className="mb-4">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
              <svg
                className="h-6 w-6 text-blue-600 dark:text-blue-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              Allow Location Access?
            </h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              This helps provide more relevant responses for weather, local events, and location-specific queries.
            </p>
          </div>

          {/* Options */}
          <div className="space-y-2">
            <button
              onClick={handleAllow}
              className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              Allow
            </button>
            <button
              onClick={handleAllowWhileUsing}
              className="w-full rounded-lg bg-zinc-100 dark:bg-zinc-800 px-4 py-3 text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            >
              Allow While Using
            </button>
            <button
              onClick={handleNever}
              className="w-full rounded-lg bg-zinc-100 dark:bg-zinc-800 px-4 py-3 text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            >
              Never
            </button>
          </div>

          {/* Privacy note */}
          <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-500">
            Your location is stored locally and only sent with queries when needed. You can change this anytime in Settings.
          </p>
        </div>
      </div>
    </div>
  );
}
