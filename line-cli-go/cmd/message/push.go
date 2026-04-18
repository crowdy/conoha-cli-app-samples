package message

import (
	"fmt"

	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/line/line-bot-sdk-go/v8/linebot/messaging_api"
	"github.com/spf13/cobra"
)

var pushCmd = &cobra.Command{
	Use:   "push",
	Short: "Send a push message to a user",
	RunE: func(cmd *cobra.Command, args []string) error {
		to, _ := cmd.Flags().GetString("to")
		text, _ := cmd.Flags().GetString("text")
		payloadFile, _ := cmd.Flags().GetString("payload-file")

		if to == "" {
			return fmt.Errorf("--to is required")
		}
		p := output.NewPrinter(config.JSONMode(), nil)

		msgs, err := buildMessages(text, payloadFile)
		if err != nil {
			return err
		}

		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}

		resp, err := api.PushMessage(
			&messaging_api.PushMessageRequest{
				To:       to,
				Messages: msgs,
			},
			"",
		)
		if err != nil {
			p.Error(0, err.Error())
			return err
		}

		sentIDs := make([]string, 0)
		if resp != nil {
			for _, m := range resp.SentMessages {
				sentIDs = append(sentIDs, m.Id)
			}
		}
		p.Raw(map[string]any{
			"sentMessages": sentIDs,
		})
		return nil
	},
}

func init() {
	pushCmd.Flags().String("to", "", "recipient user ID (required)")
	pushCmd.Flags().String("text", "", "text message content")
	pushCmd.Flags().String("payload-file", "", "JSON file with message payload")
}
