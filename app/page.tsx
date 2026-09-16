import { GuestLanding } from "@/components/guest-landing";
import { getPublicChannelAccess } from "@/lib/channels/access";

export default function LandingPage() {
  return <GuestLanding channelAccess={getPublicChannelAccess()} />;
}
