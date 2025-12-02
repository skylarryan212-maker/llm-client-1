"use client";

import { useState, useEffect } from "react";

export function useLocationPermission() {
  const [shouldShowModal, setShouldShowModal] = useState(false);

  useEffect(() => {
    // Check if user has already made a choice
    const preference = localStorage.getItem("location_preference");
    
    // If no preference set, show modal
    if (!preference) {
      // Small delay to avoid flash on page load
      setTimeout(() => {
        setShouldShowModal(true);
      }, 500);
    }
  }, []);

  const closeModal = () => {
    setShouldShowModal(false);
  };

  return { shouldShowModal, closeModal };
}

export function getLocationData() {
  const preference = localStorage.getItem("location_preference");
  
  if (preference === "never" || preference === "denied") {
    return null;
  }

  const locationData = localStorage.getItem("location_data");
  if (!locationData) {
    return null;
  }

  try {
    return JSON.parse(locationData) as {
      lat: number;
      lng: number;
      city: string;
      timestamp: number;
    };
  } catch {
    return null;
  }
}

export function clearLocationData() {
  localStorage.removeItem("location_preference");
  localStorage.removeItem("location_data");
}
