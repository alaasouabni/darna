import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "./client";
import { buildQuery } from "./query";

export type ContextWorldOption = {
  id: string;
  slug: string;
  name: string;
  domain: string | null;
  roomCount: number;
  activeRoomCount: number;
  defaultRoomUrl: string | null;
};

export type ContextRoomOption = {
  id: string;
  name: string;
  roomUrl: string;
  wamUrl: string | null;
  isActive: boolean;
  isDefault: boolean;
  worldSlug: string;
  worldName: string;
  worldDomain: string | null;
  tags: string[];
};

export type ContextOptionsResponse = {
  summary: {
    totalWorlds: number;
    totalRooms: number;
    totalActiveRooms: number;
    totalInactiveRooms: number;
  };
  worlds: ContextWorldOption[];
  rooms: ContextRoomOption[];
};

export function useContextOptionsQuery(includeInactive = true) {
  return useQuery({
    queryKey: ["context", "options", includeInactive],
    queryFn: () =>
      apiRequest<ContextOptionsResponse>(
        buildQuery("/context/options", {
          includeInactive: includeInactive ? 1 : 0,
        })
      ),
  });
}

