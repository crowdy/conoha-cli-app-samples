package message

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/line/line-bot-sdk-go/v8/linebot/messaging_api"
	"github.com/spf13/cobra"
)

var broadcastCmd = &cobra.Command{
	Use:   "broadcast",
	Short: "Send a message to all users",
	RunE: func(cmd *cobra.Command, args []string) error {
		text, _ := cmd.Flags().GetString("text")
		payloadFile, _ := cmd.Flags().GetString("payload-file")
		p := output.NewPrinter(config.JSONMode(), nil)

		msgs, err := buildMessages(text, payloadFile)
		if err != nil {
			return err
		}

		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}

		_, err = api.Broadcast(
			&messaging_api.BroadcastRequest{
				Messages: msgs,
			},
			"",
		)
		if err != nil {
			p.Error(0, err.Error())
			return err
		}

		p.Success("Broadcast sent", nil)
		return nil
	},
}

func init() {
	broadcastCmd.Flags().String("text", "", "text message content")
	broadcastCmd.Flags().String("payload-file", "", "JSON file with message payload")
}
