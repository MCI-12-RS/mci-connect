import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface RetryLineProps {
  message: string;
  onRetry: () => void;
  className?: string;
}

const RetryLine = ({ message, onRetry, className }: RetryLineProps) => (
  <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-sm", className)}>
    <span role="alert" className="text-destructive">
      {message}
    </span>
    <Button type="button" variant="outline" onClick={onRetry}>
      Tentar novamente
    </Button>
  </div>
);

export default RetryLine;
