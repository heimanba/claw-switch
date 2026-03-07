import { Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

interface ProviderEmptyStateProps {
  onCreate?: () => void;
}

export function ProviderEmptyState({
  onCreate,
}: ProviderEmptyStateProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-10 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <Users className="h-7 w-7 text-text-muted" />
      </div>
      <h3 className="text-lg font-semibold">{t("provider.noProviders")}</h3>
      <p className="mt-2 max-w-sm text-sm text-text-muted">
        {t("provider.noProvidersDescription")}
      </p>
      <div className="mt-6 flex flex-col gap-2">
        {onCreate && (
          <Button onClick={onCreate}>
            {t("provider.addProvider")}
          </Button>
        )}
      </div>
    </div>
  );
}
