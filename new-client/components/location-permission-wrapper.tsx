"use client";

import { LocationPermissionModal } from "@/components/location-permission-modal";
import { useLocationPermission } from "@/lib/hooks/useLocationPermission";

export function LocationPermissionWrapper() {
  const { shouldShowModal, closeModal } = useLocationPermission();

  if (!shouldShowModal) {
    return null;
  }

  return <LocationPermissionModal onClose={closeModal} />;
}
