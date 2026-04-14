"use client";

import Link from "next/link";
import { hardhat } from "viem/chains";
import { FireIcon } from "@heroicons/react/24/solid";
import { FaucetButton, RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth";

export const Header = () => {
  const { targetNetwork } = useTargetNetwork();
  const isLocalNetwork = targetNetwork.id === hardhat.id;

  return (
    <div className="sticky lg:static top-0 navbar bg-base-100 min-h-0 shrink-0 justify-between z-20 shadow-md shadow-secondary px-0 sm:px-2">
      <div className="navbar-start w-auto lg:w-1/2">
        <Link href="/" passHref className="flex items-center gap-2 ml-4 mr-6 shrink-0">
          <FireIcon className="h-8 w-8 text-orange-500" />
          <div className="flex flex-col">
            <span className="font-bold leading-tight tracking-wider">BURN JACKPOT</span>
            <span className="text-xs opacity-70">CLAWD lottery · 20% burned every round</span>
          </div>
        </Link>
      </div>
      <div className="navbar-end grow mr-4 gap-2">
        <RainbowKitCustomConnectButton />
        {isLocalNetwork && <FaucetButton />}
      </div>
    </div>
  );
};
