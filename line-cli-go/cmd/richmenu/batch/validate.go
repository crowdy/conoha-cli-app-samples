package batch

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"
	"line-cli-go/internal/payload"

	"github.com/line/line-bot-sdk-go/v8/linebot/messaging_api"
	"github.com/spf13/cobra"
)

var validateCmd = &cobra.Command{
	Use:   "validate",
	Short: "Validate a batch operations payload without executing it",
	RunE: func(cmd *cobra.Command, args []string) error {
		payloadFile, _ := cmd.Flags().GetString("payload-file")
		var req messaging_api.RichMenuBatchRequest
		if err := payload.LoadJSON(payloadFile, &req); err != nil {
			return err
		}
		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		if _, err := api.ValidateRichMenuBatchRequest(&req); err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		p.Success("Batch payload valid", nil)
		return nil
	},
}

func init() {
	validateCmd.Flags().String("payload-file", "", "path to JSON payload (use '-' for stdin) (required)")
	BatchCmd.AddCommand(validateCmd)
}
