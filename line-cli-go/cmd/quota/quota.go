package quota

import "github.com/spf13/cobra"

var QuotaCmd = &cobra.Command{
	Use:   "quota",
	Short: "Check message quota and consumption",
}

func init() {
	QuotaCmd.AddCommand(getCmd)
	QuotaCmd.AddCommand(consumptionCmd)
}
